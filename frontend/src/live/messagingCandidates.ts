import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
import { listLiveRoleGrants } from "./features/membership";
import { getCachedIcpIdentityProfile } from "./identityProfileCache";
import { withReadDeadline } from "./readDeadline";

/**
 * Shared candidate-resolution helper for the messaging "pick people" dialogs
 * (AddGroupMembersDialog, CreateGroupDialog, StartDMDialog) when messaging is
 * routed to ICP. Builds the addressable-person list from club_domain role
 * grants (the canister counterpart of the Supabase `user_roles` membership
 * roster) since there is no Supabase `profiles`/`user_roles` table to query
 * for Internet-Identity-only accounts.
 *
 * Display names come from the identity_access profile cache when available
 * (populated after sign-in / profile completion); accounts with no cached
 * profile fall back to a short, readable form of their principal text so the
 * picker never shows a blank row.
 */

export interface LiveMessagingCandidateRole {
  role: string;
  clubId: string | null;
  teamId: string | null;
}

export interface LiveMessagingCandidate {
  /** Principal text — the canonical id for an Internet Identity account. */
  id: string;
  principal: Principal;
  display_name: string;
  avatar_url: string | null;
  roles: LiveMessagingCandidateRole[];
}

/** club_domain account ids are "principal:<text>"; return the bare principal text. */
export function normalizeAccountId(accountId: string): string {
  return accountId.startsWith("principal:") ? accountId.slice("principal:".length) : accountId;
}

export function shortPrincipalLabel(principalText: string): string {
  if (principalText.length <= 12) return principalText;
  return `${principalText.slice(0, 5)}…${principalText.slice(-4)}`;
}

/**
 * Resolves the set of principals holding a role in any of `clubIds`,
 * excluding the caller and anyone in `excludeIds` (e.g. existing group
 * participants). Safe to call with an empty `clubIds` list — returns [].
 */
// Each club roster read is a consensus call with an account check (seconds on
// mainnet). The Messages inbox already reads it when it opens, so remember the
// answer briefly (memory only) and let New Message / group pickers reuse it.
const ROSTER_TTL_MS = 3 * 60_000;
const rosterMemo = new Map<string, { at: number; read: Promise<Awaited<ReturnType<typeof listLiveRoleGrants>>> }>();
function rememberedRoleGrants(ctx: FeatureBackendContext, caller: string, clubId: string) {
  const key = JSON.stringify([caller, ctx.target.host, ctx.target.networkKind,
    Object.entries(ctx.target.canisterIds).sort(([a], [b]) => a.localeCompare(b)), clubId]);
  const hit = rosterMemo.get(key);
  if (hit && Date.now() - hit.at < ROSTER_TTL_MS) return hit.read;
  const read = withReadDeadline(listLiveRoleGrants(ctx, clubId), "Club members", 20_000);
  rosterMemo.set(key, { at: Date.now(), read });
  read.catch(() => { if (rosterMemo.get(key)?.read === read) rosterMemo.delete(key); });
  if (rosterMemo.size > 50) rosterMemo.delete(rosterMemo.keys().next().value as string);
  return read;
}
export function __resetMessagingRosterMemo() { rosterMemo.clear(); }

export async function fetchLiveMessagingCandidates(
  ctx: FeatureBackendContext,
  clubIds: string[],
  excludeIds: Set<string> = new Set(),
): Promise<LiveMessagingCandidate[]> {
  const uniqueClubIds = [...new Set(clubIds.filter(Boolean))];
  if (uniqueClubIds.length === 0) return [];

  const selfText = ctx.identity.getPrincipal().toText();
  const grantLists = await Promise.all(
    uniqueClubIds.map((clubId) => rememberedRoleGrants(ctx, selfText, clubId)),
  );

  const byAccount = new Map<string, LiveMessagingCandidateRole[]>();
  for (const grants of grantLists) {
    for (const grant of grants) {
      // club_domain returns account ids as "principal:<text>"; strip the
      // prefix or every grant fails Principal.fromText and the self check —
      // which left default/sub-committee chats with only their creator.
      const accountId = normalizeAccountId(grant.account_id);
      if (accountId === selfText || excludeIds.has(accountId)) continue;
      const roles = byAccount.get(accountId) ?? [];
      roles.push({
        role: grant.role,
        clubId: grant.club[0] ?? null,
        teamId: grant.team[0] ?? null,
      });
      byAccount.set(accountId, roles);
    }
  }

  const candidates: LiveMessagingCandidate[] = [];
  for (const [accountId, roles] of byAccount.entries()) {
    let principal: Principal;
    try {
      principal = Principal.fromText(accountId);
    } catch {
      continue;
    }
    const cachedProfile = getCachedIcpIdentityProfile(accountId);
    candidates.push({
      id: accountId,
      principal,
      display_name: cachedProfile?.displayName || shortPrincipalLabel(accountId),
      avatar_url: cachedProfile?.avatarRef ?? null,
      roles,
    });
  }
  return candidates;
}
