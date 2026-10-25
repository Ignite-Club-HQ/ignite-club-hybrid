import type { FeatureBackendContext } from "@/live/featureRouter";
import { readMembershipInScope } from "@/live/membershipRouting";
import { listLiveClubRewards, listLiveRedemptions } from "@/live/features/points";

const normalize = (id: string) => id.startsWith("principal:") ? id.slice(10) : id;
export async function readIcpRewardReport(ctx: FeatureBackendContext, clubId: string, teamId: string | null, from: Date, to: Date) {
  const [redemptions, rewards] = await Promise.all([
    listLiveRedemptions(ctx, clubId, null), listLiveClubRewards(ctx, clubId, null, false),
  ]);
  let rows = redemptions.filter(row => {
    const time = Number(row.redeemed_at_ms[0] ?? row.created_at_ms);
    return time >= from.getTime() && time <= to.getTime();
  });
  if (teamId) {
    const members = await readMembershipInScope(ctx, { clubId }, async scoped => {
      const [{ listLiveTeams }, { listLiveTeamRoleGrants }, { listLiveChildTeamAssignments }] = await Promise.all([
        import("@/live/features/club"), import("@/live/features/membership"), import("@/live/features/events"),
      ]);
      if (!(await listLiveTeams(scoped, clubId)).some(team => team.id === teamId && team.club_id === clubId)) throw new Error("Team does not belong to this club");
      const [roles, children] = await Promise.all([listLiveTeamRoleGrants(scoped, teamId), listLiveChildTeamAssignments(scoped, clubId, teamId)]);
      return { adults: new Set(roles.map(role => normalize(role.account_id))), children: new Set(children.map(child => child.child_id)) };
    });
    rows = rows.filter(row => row.child_id[0] ? members.children.has(row.child_id[0]) : !!row.user_id[0] && members.adults.has(normalize(row.user_id[0])));
  }
  const [profiles, childNames] = await readMembershipInScope(ctx, { clubId }, async scoped => {
    const [{ listLiveProfilesByIds }, { resolveLivePiiTextBatch }] = await Promise.all([
      import("@/live/features/identityAccessClient"), import("@/live/features/vault"),
    ]);
    return Promise.all([
      listLiveProfilesByIds(scoped, [...new Set(rows.flatMap(row => row.user_id))]),
      resolveLivePiiTextBatch(scoped, [...new Set(rows.flatMap(row => row.child_id))], "name", "reward_report", "Authorized reward recipients"),
    ]);
  });
  const names = new Map(profiles.map(profile => [normalize(profile.account_id), profile.display_name]));
  const catalog = new Map(rewards.map(reward => [reward.id, reward]));
  return rows.sort((a, b) => Number(b.redeemed_at_ms[0] ?? b.created_at_ms) - Number(a.redeemed_at_ms[0] ?? a.created_at_ms)).map(row => {
    const reward = catalog.get(row.reward_id);
    const child = row.child_id[0]; const user = row.user_id[0];
    return { id: row.id, reward_id: row.reward_id, points_spent: row.points_spent, status: row.status,
      redeemed_at: new Date(Number(row.redeemed_at_ms[0] ?? row.created_at_ms)).toISOString(), child_id: child ?? null, user_id: user ?? null,
      club_rewards: reward ? { id: reward.id, name: reward.name, reward_type: reward.reward_type } : null,
      children: child ? { name: childNames.get(child) ?? "Player" } : null,
      profiles: user && names.has(normalize(user)) ? { display_name: names.get(normalize(user)) ?? "Member" } : null };
  });
}