/**
 * Shared "which club owns this row?" lookup used by both the route club-scope
 * guard and notification-driven club switching.
 *
 * Why it exists: several club-scoped tables (`events`, `photos`, `chat_groups`,
 * `vault_folders`) legitimately store a NULL `club_id` when the row belongs to a
 * TEAM rather than the whole club. A team-only event push therefore resolved to
 * `null` — the notification opened `/events/:id` but the global club filter
 * stayed on whichever club was previously selected (and `useClubScopeGuard`
 * could bounce the user home). Team chats never hit this because they resolve
 * through `teams.club_id` directly, which is why "messages switch fine".
 *
 * Resolution: read `club_id`, and when it is NULL fall back to the row's
 * `team_id` → `teams.club_id`. Fail-open: any error resolves to `null` so the
 * caller leaves the current filter untouched instead of guessing.
 */

import { supabase } from "@/integrations/supabase/client";
import { isIcpSession, icpGetTeam, icpGetClubName, icpListTeams, icpListClubs, icpCtx } from "@/lib/icpClubTeamLookup";
import type { ClubScopeTable } from "@/lib/routeClubScope";

/** Tables whose owning club can be recovered from a `team_id` column. */
const TEAM_FALLBACK_TABLES: ReadonlySet<ClubScopeTable> = new Set([
  "events",
  "photos",
  "chat_groups",
  "vault_folders",
]);

export async function lookupRouteClubId(
  table: ClubScopeTable,
  id: string,
): Promise<string | null> {
  // ICP mode: the primary row read must come from the canisters — a direct
  // Supabase read here is blocked by the strict transport (and would fire on
  // every club-scoped route). Fail open to null exactly like the Supabase
  // path so the guard never bounces a user on an unresolved lookup.
  if (isIcpSession()) {
    try {
      switch (table) {
        case "teams":
          return (await icpGetTeam(id))?.club_id ?? null;
        case "chat_groups": {
          const { getLiveGroupMetadata } = await import("@/live/features/messaging");
          const meta = await getLiveGroupMetadata(await icpCtx(), id);
          if (meta.clubId) return meta.clubId;
          if (meta.teamId) return (await icpGetTeam(meta.teamId))?.club_id ?? null;
          return null;
        }
        case "mini_leagues": {
          const { getLiveMiniLeague } = await import("@/live/features/miniLeagues");
          const league = await getLiveMiniLeague(await icpCtx(), id);
          return (league?.club_id as string | null) ?? null;
        }
        default:
          // events / photos / vault_folders / club_links /
          // club_admin_conversations have no single-row owning-club reader
          // yet — fail open (the guard simply doesn't redirect).
          return null;
      }
    } catch {
      return null;
    }
  }
  const wantsTeam = TEAM_FALLBACK_TABLES.has(table);
  const { data, error } = await (supabase as any)
    .from(table)
    .select(wantsTeam ? "club_id, team_id" : "club_id")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  if (data.club_id) return data.club_id as string;

  const teamId = wantsTeam ? (data.team_id as string | null) : null;
  if (!teamId) return null;

  if (isIcpSession()) {
    try { return (await icpGetTeam(teamId))?.club_id ?? null; } catch { return null; }
  }
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("club_id")
    .eq("id", teamId)
    .maybeSingle();
  if (teamError) return null;
  return ((team as { club_id?: string | null } | null)?.club_id as string | null) ?? null;
}
