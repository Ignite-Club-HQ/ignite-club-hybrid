import type { FeatureBackendContext } from "@/live/featureRouter";
import { readMembershipInScope } from "@/live/membershipRouting";
import { readPointsInClub } from "@/live/pointsRouting";
import { getLiveMyRoleGrants } from "@/live/features/membership";
import { getLiveClubProfile, getLiveTeam, isLiveClubPro } from "@/live/features/club";
import {
  getLiveClubPointsSettings,
  listLiveClubRewards,
  listLivePointsHistory,
  listLiveRedemptions,
  subjectForChild,
  subjectForUser,
} from "@/live/features/points";

/**
 * On-chain reads backing the Profile page Rewards card and Points history.
 * The canister only reads one club at a time, so "All Clubs" views fan out
 * over the caller's clubs and join club / reward names client-side.
 */

/** Club ids the caller belongs to (club-wide grants plus team grants' clubs). */
export async function liveMyRewardClubIds(ctx: FeatureBackendContext): Promise<string[]> {
  const grants = await getLiveMyRoleGrants(ctx);
  const ids = new Set<string>();
  const teamIds = new Set<string>();
  for (const g of grants) {
    if (g.club[0]) ids.add(g.club[0]);
    else if (g.team[0]) teamIds.add(g.team[0]);
  }
  const teams = await Promise.all(
    [...teamIds].map((t) => readMembershipInScope(ctx, { teamId: t }, scoped => getLiveTeam(scoped, t))),
  );
  for (const t of teams) {
    const clubId = (t[0] as { club_id?: string } | undefined)?.club_id;
    if (clubId) ids.add(clubId);
  }
  return [...ids];
}

export interface LiveRewardClub {
  id: string;
  name: string;
  logo_url: string | null;
  points_display_name: string | null;
  points_icon_url: string | null;
  hasPro: boolean;
}

export async function liveRewardClubs(
  ctx: FeatureBackendContext,
  clubIds: string[],
): Promise<LiveRewardClub[]> {
  const rows = await Promise.all(
    clubIds.map(async (id) => {
      const [profile, settings, hasPro] = await Promise.all([
        readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubProfile(scoped, id)),
        readPointsInClub(ctx, id, scoped => getLiveClubPointsSettings(scoped, id)),
        readMembershipInScope(ctx, { clubId: id }, scoped => isLiveClubPro(scoped, id)),
      ]);
      const p = profile[0];
      if (!p) return null;
      return {
        id,
        name: p.name,
        logo_url: p.logo_url[0] ?? null,
        points_display_name: settings?.display_name?.[0] ?? null,
        points_icon_url: settings?.points_icon_url?.[0] ?? null,
        hasPro,
      } satisfies LiveRewardClub;
    }),
  );
  return rows.filter((r): r is LiveRewardClub => !!r);
}

export function mapLiveReward(r: Awaited<ReturnType<typeof listLiveClubRewards>>[number]) {
  return {
    id: r.id,
    club_id: r.club_id,
    name: r.name,
    description: r.description[0] ?? null,
    points_required: r.points_required,
    is_active: r.is_active,
    is_default: r.is_default,
    logo_url: r.logo_url[0] ?? null,
    qr_code_url: r.qr_code_url[0] ?? null,
    show_qr_code: r.show_qr_code,
    reward_type: r.reward_type,
    sponsors: null,
  };
}

/** Active, redeemable (non player-of-match) rewards for the given clubs. */
export async function liveRedeemableRewards(ctx: FeatureBackendContext, clubIds: string[]) {
  const lists = await Promise.all(
    clubIds.map((id) => readPointsInClub(ctx, id, scoped => listLiveClubRewards(scoped, id, null, true))),
  );
  return lists
    .flat()
    .filter((r) => r.is_active && r.reward_type !== "player_of_match")
    .map(mapLiveReward)
    .sort((a, b) => a.points_required - b.points_required);
}

async function clubNameMap(ctx: FeatureBackendContext, clubIds: string[]) {
  const m = new Map<string, string>();
  await Promise.all(
    clubIds.map(async (id) => {
      const p = await readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubProfile(scoped, id));
      if (p[0]) m.set(id, p[0].name);
    }),
  );
  return m;
}

/** Points history for the caller across one club or all of their clubs, newest first. */
export async function liveMyPointsHistory(
  ctx: FeatureBackendContext,
  userId: string,
  clubFilter: string | null,
  limit = 100,
) {
  const clubIds = clubFilter ? [clubFilter] : await liveMyRewardClubIds(ctx);
  const [pages, names] = await Promise.all([
    Promise.all(
      clubIds.map((id) =>
        readPointsInClub(ctx, id, scoped => listLivePointsHistory(scoped, id, subjectForUser(userId), 0, limit)),
      ),
    ),
    clubNameMap(ctx, clubIds),
  ]);
  return pages
    .flatMap((p) => p?.items ?? [])
    .sort((a, b) => Number(b.created_at_ms) - Number(a.created_at_ms))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      amount: entry.amount,
      balance_after: entry.balance_after,
      source_type: entry.source_type,
      source_id: entry.source_id[0] ?? null,
      description: entry.description,
      created_at: new Date(Number(entry.created_at_ms)).toISOString(),
      club_id: entry.club_id,
      clubs: names.has(entry.club_id) ? { name: names.get(entry.club_id) ?? "" } : null,
    }));
}

/**
 * Redemptions across one club or all of the caller's clubs, newest first,
 * with club / reward / child names joined client-side. Reads the caller's
 * own redemptions plus those of the given children (subject-scoped reads).
 */
export async function liveMyRedemptions(
  ctx: FeatureBackendContext,
  userId: string,
  clubFilter: string | null,
  childNames: Map<string, string> = new Map(),
) {
  const subjects = [subjectForUser(userId), ...[...childNames.keys()].map(subjectForChild)];
  const clubIds = clubFilter ? [clubFilter] : await liveMyRewardClubIds(ctx);
  const [lists, names, rewards] = await Promise.all([
    Promise.all(clubIds.flatMap((id) => subjects.map((sub) => readPointsInClub(ctx, id, scoped => listLiveRedemptions(scoped, id, sub))))),
    clubNameMap(ctx, clubIds),
    Promise.all(clubIds.map((id) => readPointsInClub(ctx, id, scoped => listLiveClubRewards(scoped, id, null, false)))),
  ]);
  const rewardById = new Map(rewards.flat().map((r) => [r.id, mapLiveReward(r)]));
  return lists
    .flat()
    .sort((a, b) => Number(b.created_at_ms) - Number(a.created_at_ms))
    .map((r) => {
      const childId = r.child_id[0] ?? null;
      const redeemedMs = r.redeemed_at_ms[0] ?? r.created_at_ms;
      return {
        id: r.id,
        reward_id: r.reward_id,
        club_id: r.club_id,
        points_spent: r.points_spent,
        status: r.status,
        redeemed_at: new Date(Number(redeemedMs)).toISOString(),
        created_at: new Date(Number(r.created_at_ms)).toISOString(),
        child_id: childId,
        club_rewards: rewardById.get(r.reward_id) ?? null,
        clubs: { name: names.get(r.club_id) ?? "" },
        children: childId ? { id: childId, name: childNames.get(childId) ?? "Child" } : null,
      };
    });
}
