import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";

export interface InviteDedupeMatch {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  already_in_club: boolean;
  already_in_team: boolean;
  already_in_mini_league: boolean;
}

/**
 * Local email validator used before we spend an RPC call on lookup.
 * We intentionally require a plausible local + domain structure with a TLD.
 * Rejects: empty, whitespace-only, no @, missing local, missing domain,
 * missing TLD, addresses with internal whitespace.
 *
 * Exported so callers can share the same acceptance rule as the RPC path.
 */
export function isPlausibleInvitableEmail(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  const email = raw.trim();
  if (email.length === 0) return false;
  if (/\s/.test(email)) return false; // no internal whitespace
  if (email.length > 254) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain) return false;
  // Domain must contain at least one dot with a 2+ char TLD.
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(domain)) {
    return false;
  }
  // Local part: allow standard characters only.
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return true;
}

/**
 * Type-guard for RPC response rows. The RPC is treated as untrusted data:
 * we accept only an object (or the first entry of an array) whose fields
 * match the expected invite-dedupe shape. Any string, number, malformed
 * array, or object missing `user_id` returns `null` — the caller falls back
 * to the standard privacy-safe email invite path.
 */
function parseDedupeResponse(raw: unknown): InviteDedupeMatch | null {
  if (raw == null) return null;
  const candidate: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (!candidate || typeof candidate !== "object") return null;
  const rec = candidate as Record<string, unknown>;
  if (typeof rec.user_id !== "string" || rec.user_id.length === 0) return null;
  const boolOrFalse = (v: unknown) => v === true; // strict — non-booleans coerce to false
  const stringOrNull = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    user_id: rec.user_id,
    display_name: stringOrNull(rec.display_name),
    avatar_url: stringOrNull(rec.avatar_url),
    already_in_club: boolOrFalse(rec.already_in_club),
    already_in_team: boolOrFalse(rec.already_in_team),
    already_in_mini_league: boolOrFalse(rec.already_in_mini_league),
  };
}

/**
 * Looks up whether the given email already belongs to a member the caller
 * is allowed to see (i.e. someone in one of the caller's clubs/teams/mini-leagues).
 *
 * Returns `null` when:
 *  - email is empty / malformed (rejected locally before any RPC call)
 *  - no account exists for that email
 *  - an account exists but is outside the caller's scope (privacy-safe;
 *    the standard email invite flow will still reach them, and
 *    auth.users email uniqueness prevents true duplicate accounts at acceptance time)
 *  - the RPC returns malformed / unexpected data
 *
 * Returns a match when the email belongs to an existing user the caller
 * shares context with.
 */
export async function lookupInvitableUserByEmail(opts: {
  email: string;
  clubId?: string | null;
  teamId?: string | null;
  miniLeagueId?: string | null;
}): Promise<InviteDedupeMatch | null> {
  const email = (opts.email ?? "").trim().toLowerCase();
  if (!isPlausibleInvitableEmail(email)) return null;

  return withFeatureBackend("membership", {
    supabase: async () => {
      const { data, error } = await supabase.rpc("lookup_invitable_user_by_email", {
        _email: email,
        _club_id: opts.clubId ?? null,
        _team_id: opts.teamId ?? null,
        _mini_league_id: opts.miniLeagueId ?? null,
      });

      if (error) {
        // Don't block the invite flow on a lookup error — just skip dedupe.
        console.warn("[inviteEmailDedupe] lookup failed", error.message);
        return null;
      }

      return parseDedupeResponse(data);
    },
    // club_domain has no email-indexed account lookup (and Internet Identity
    // accounts have no email on file), so dedupe-by-*account* still has no
    // ICP equivalent. What it does have is an email-hash index on pending
    // invites (set_pending_invite_email_hash/find_pending_invite_by_email_hash)
    // — use it to report an already-pending invite for this club so callers
    // don't create a duplicate. No club id means nothing to hash against.
    icp: async (ctx) => {
      if (!opts.clubId) return null;
      const { findLivePendingInviteByEmailHash } = await import("@/live/features/club");
      const hash = await hashInviteEmail(email, opts.clubId);
      let foundOpt: unknown;
      try {
        foundOpt = await findLivePendingInviteByEmailHash(ctx, opts.clubId, hash);
      } catch (error) {
        // Dedupe is advisory: a failed lookup falls back to a normal invite.
        console.warn("[inviteEmailDedupe] pending-invite lookup failed (ICP)", error);
        return null;
      }
      const found = Array.isArray(foundOpt) ? foundOpt[0] : foundOpt;
      if (!found) return null;
      return {
        user_id: found.invite_id,
        display_name: null,
        avatar_url: null,
        already_in_club: true,
        already_in_team: false,
        already_in_mini_league: false,
      };
    },
  }, { clubId: opts?.clubId as string });
}

/**
 * SHA-256 hash of the lowercased email + club id, used as the canister-side
 * dedupe key for pending invites (club_domain never stores the plaintext
 * email on this index — see set_pending_invite_email_hash in live/features/club.ts).
 */
export async function hashInviteEmail(email: string, clubId: string): Promise<string> {
  const normalized = `${email.trim().toLowerCase()}:${clubId}`;
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
