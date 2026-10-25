import { withFeatureBackend } from "./featureRouter";
import { writeOnce } from "./clubScope";
import { listLiveClubs } from "./features/club";
import { listLiveClubSubscriptionsStrict } from "./features/proAccess";
import { listLiveAllClubDmSettings, setLiveClubAiCatchUp, enableLiveAiCatchUpForAllMembers } from "./features/messaging";
import { getLiveClubSubscription } from "./features/club";
import { readMembershipInScope } from "./membershipRouting";
const unavailable = async (): Promise<never> => { throw new Error("Internet Identity required"); };
export async function readAdminProCatchUpClubs() {
  return withFeatureBackend("membership", { supabase: unavailable, icp: async ctx => {
    const clubs: { id: string; name: string }[] = []; let cursor: string | null = null;
    for (let page = 0; page < 40; page++) {
      const rows = await listLiveClubs(ctx, cursor, 50);
      for (const row of rows) if (row.is_active && row.deleted_at_ms.length === 0) clubs.push({ id: row.id, name: row.name });
      if (rows.length < 50) break;
      const next = rows.at(-1)?.id;
      if (!next || next === cursor || page === 39) throw new Error("Club directory is incomplete");
      cursor = next;
    }
    const [subs, settings] = await Promise.all([listLiveClubSubscriptionsStrict(ctx, clubs.map(c => c.id)), listLiveAllClubDmSettings(ctx)]);
    return clubs.flatMap(club => {
      const sub = subs.get(club.id);
      if (!sub || !(sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) || (sub.expires_at_ms[0] !== undefined && Number(sub.expires_at_ms[0]) <= Date.now())) return [];
      // messaging_domain's absent-row default is enabled, not disabled.
      return [{ ...club, ai_catch_up_enabled: settings.find(s => s.clubId === club.id)?.aiCatchUpEnabled ?? true, is_pro_football: sub.is_pro_football || sub.admin_pro_football_override }];
    });
  } }, { everyGroup: true, requireComplete: true, merge: parts => {
    const rows = (parts as Array<Array<{ id: string; name: string; ai_catch_up_enabled: boolean; is_pro_football: boolean }>>).flat();
    const seen = new Set<string>();
    for (const row of rows) { if (seen.has(row.id)) throw new Error("Club appears under more than one authority"); seen.add(row.id); }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  } });
}
export async function enableAdminProCatchUpClubs(ids: string[], all: boolean) {
  const eligible = await readAdminProCatchUpClubs(); const fresh = new Set(eligible.map(c => c.id));
  const reviewed = [...new Set(ids)];
  if (reviewed.some(id => !fresh.has(id)) || (all && reviewed.length !== fresh.size)) throw new Error("Eligible clubs changed. Refresh and confirm the selection again.");
  let flags = 0; let completed = 0; let members = 0;
  try { for (const id of reviewed) {
    await withFeatureBackend("messaging", { supabase: unavailable, icp: async ctx => {
      const sub = await readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubSubscription(scoped, id));
      if (!sub || !(sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) || (sub.expires_at_ms[0] !== undefined && Number(sub.expires_at_ms[0]) <= Date.now())) throw new Error("Club eligibility changed");
      return setLiveClubAiCatchUp(ctx, id, true);
    } }, writeOnce({ clubId: id })); flags++;
    members += await withFeatureBackend("messaging", { supabase: unavailable, icp: ctx => enableLiveAiCatchUpForAllMembers(ctx, id) }, writeOnce({ clubId: id })); completed++;
  } } catch { throw new Error(`Acknowledged ${flags} club flags and ${completed} member updates (${members} members); the attempted step is unconfirmed. Do not retry the whole batch.`); }
  return { clubs_updated: flags, members_updated: members, total_pro_clubs: reviewed.length };
}