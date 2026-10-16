import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
import { fetchLiveMessagingCandidates } from "./messagingCandidates";
import {
  addLiveGroupMembers,
  createLiveGroupWithRoles,
  listLiveGroupsByClub,
} from "./features/messaging";

/**
 * ICP counterpart of the Supabase `create_default_club_chats` trigger: every
 * club gets "Coaches", "Team Admins" and "Club Committee" chats. Supabase
 * groups are role-based; canister groups have explicit members, so this
 * creates any missing default chat and tops up membership with everyone
 * currently holding a matching role. Safe to call repeatedly (idempotent).
 */
export const DEFAULT_CLUB_CHATS: Array<{ name: string; roles: string[] }> = [
  { name: "Coaches", roles: ["coach", "club_admin", "app_admin"] },
  { name: "Team Admins", roles: ["team_admin", "club_admin", "app_admin"] },
  { name: "Club Committee", roles: ["committee_member", "club_admin", "app_admin"] },
];

const syncedThisSession = new Set<string>();

export async function ensureLiveDefaultClubChats(
  ctx: FeatureBackendContext,
  clubId: string,
  opts: { force?: boolean } = {},
): Promise<string[]> {
  const failures: string[] = [];
  if (!clubId) return failures;
  if (!opts.force && syncedThisSession.has(clubId)) return failures;
  syncedThisSession.add(clubId);

  const self = ctx.identity.getPrincipal();
  const selfText = self.toText();
  const [existing, candidates] = await Promise.all([
    listLiveGroupsByClub(ctx, clubId).catch(() => []),
    fetchLiveMessagingCandidates(ctx, [clubId]).catch(() => []),
  ]);

  for (const def of DEFAULT_CLUB_CHATS) {
    const matching = candidates.filter((c) =>
      c.roles.some((r) => def.roles.includes(r.role) && (r.clubId === clubId || r.role === "app_admin")),
    );
    const group = existing.find((g) => !g.teamId && g.name.trim().toLowerCase() === def.name.toLowerCase());
    try {
      if (!group) {
        const entries: Array<[Principal, string]> = [[self, "owner"]];
        for (const c of matching) {
          if (c.id !== selfText) entries.push([c.principal, "member"]);
        }
        await createLiveGroupWithRoles(ctx, clubId, null, def.name, "group", entries);
      } else if (matching.length > 0) {
        // Members already in the group are skipped canister-side.
        await addLiveGroupMembers(ctx, group.conversationId, matching.map((c) => c.principal));
      }
    } catch (err) {
      // Best-effort: callers without manage rights just skip the top-up.
      console.warn(`[defaultClubChats] ${def.name} sync failed`, err);
      if (!group) failures.push(`${def.name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }
  // A failed creation must be retried on the next load, not skipped all session.
  if (failures.length) syncedThisSession.delete(clubId);
  return failures;
}
