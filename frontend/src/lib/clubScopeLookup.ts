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

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("club_id")
    .eq("id", teamId)
    .maybeSingle();
  if (teamError) return null;
  return ((team as { club_id?: string | null } | null)?.club_id as string | null) ?? null;
}
