import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
import { fetchLiveMessagingCandidates } from "./messagingCandidates";
import {
  addLiveGroupMembers,
  ensureLiveStandardClubChat,
  listLiveGroupsByClub,
} from "./features/messaging";

/**
 * ICP counterpart of the Supabase `create_default_club_chats` trigger: every
 * club gets "Coaches", "Team Admins" and "Club Committee" chats. Supabase
 * groups are role-based; canister groups have explicit members, so this
 * creates any missing default chat and tops up membership with everyone
 * currently holding a matching role. Safe to call repeatedly (idempotent).
 */
export const DEFAULT_CLUB_CHATS: Array<{ key: string; name: string; roles: string[] }> = [
  { key: "coaches", name: "Coaches", roles: ["coach", "club_admin", "app_admin"] },
  { key: "team_admins", name: "Team Admins", roles: ["team_admin", "club_admin", "app_admin"] },
  { key: "club_committee", name: "Club Committee", roles: ["committee_member", "club_admin", "app_admin"] },
];

const syncedThisSession = new Set<string>();
const syncing = new Map<string, Promise<string[]>>();

export async function ensureLiveDefaultClubChats(
  ctx: FeatureBackendContext,
  clubId: string,
  opts: { force?: boolean } = {},
): Promise<string[]> {
  if (!clubId) return [];
  const key = JSON.stringify([ctx.target.host, ctx.target.canisterIds.messaging_domain, ctx.identity.getPrincipal().toText(), clubId]);
  const pending = syncing.get(key);
  if (pending) return pending;
  if (!opts.force && syncedThisSession.has(key)) return [];
  const task = syncDefaultClubChats(ctx, clubId).then((failures) => {
    if (!failures.length) syncedThisSession.add(key);
    return failures;
  }).finally(() => syncing.delete(key));
  syncing.set(key, task);
  return task;
}

async function syncDefaultClubChats(ctx: FeatureBackendContext, clubId: string): Promise<string[]> {
  const failures: string[] = [];

  const self = ctx.identity.getPrincipal();
  const selfText = self.toText();
  const [existing, candidates] = await Promise.all([
    listLiveGroupsByClub(ctx, clubId),
    fetchLiveMessagingCandidates(ctx, [clubId]),
  ]);

  await Promise.all(DEFAULT_CLUB_CHATS.map(async (def) => {
    const matching = candidates.filter((c) =>
      c.roles.some((r) => def.roles.includes(r.role) && (r.clubId === clubId || r.role === "app_admin")),
    );
    // If copies already exist, top up the oldest one only; never add another.
    const group = existing
      .filter((g) => !g.teamId && g.name.trim().toLowerCase() === def.name.toLowerCase())
      .sort((a, b) => String(a.conversationId).localeCompare(String(b.conversationId)))[0];
    try {
      const entries: Array<[Principal, string]> = [[self, "owner"]];
      for (const c of matching) {
        if (c.id !== selfText) entries.push([c.principal, "member"]);
      }
      const acknowledged = await ensureLiveStandardClubChat(ctx, clubId, def.key, group?.conversationId ?? null, entries);
      if (matching.length > 0) {
        // Members already in the group are skipped canister-side.
        await addLiveGroupMembers(ctx, acknowledged.conversation_id, matching.map((c) => c.principal));
      }
    } catch (err) {
      // Best-effort: callers without manage rights just skip the top-up.
      console.warn(`[defaultClubChats] ${def.name} sync failed`, err);
      failures.push(`${def.name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }));
  return failures;
}
