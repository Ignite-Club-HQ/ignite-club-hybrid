import type { FeatureBackendContext } from "@/live/featureRouter";
import { readMembershipInScope } from "@/live/membershipRouting";
import { settleAll } from "@/live/crossGroupClubs";
import { withReadDeadline } from "@/live/readDeadline";
const rewardRead = <T,>(read: Promise<T>, label: string) => withReadDeadline(read, label, 12_000);
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
  const grants = await withReadDeadline(getLiveMyRoleGrants(ctx), 'Reward memberships', 20_000);
  const ids = new Set<string>();
  const teamIds = new Set<string>();
  for (const g of grants) {
    if (g.club[0]) ids.add(g.club[0]);
    else if (g.team[0]) teamIds.add(g.team[0]);
  }
  const { values: teams } = await settleAll(
    [...teamIds].map((t) => rewardRead(readMembershipInScope(ctx, { teamId: t }, scoped => getLiveTeam(scoped, t)), 'Reward team')),
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
  const { values: rows } = await settleAll(
    clubIds.map(async (id) => {
      const [profile, settings, hasPro] = await Promise.all([
        rewardRead(readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubProfile(scoped, id)), 'Reward club'),
        // Names/icons decorate the directory; a slow settings service must
        // not block verified club subscription access or points history.
        withReadDeadline(readPointsInClub(ctx, id, scoped => getLiveClubPointsSettings(scoped, id)), 'Points display settings', 4_000).catch(() => null),
        rewardRead(readMembershipInScope(ctx, { clubId: id }, scoped => isLiveClubPro(scoped, id)), 'Reward subscription'),
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

type SponsorLookup = ReadonlyMap<string, ReadonlyMap<string, { id: string; name: string; logo_url: string | null }>>;
async function rewardSponsorLookup(ctx: FeatureBackendContext, clubIds: string[]) {
  const result = new Map<string, Map<string, { id: string; name: string; logo_url: string | null }>>();
  const { listLiveSponsors } = await import("@/live/features/club");
  await settleAll(clubIds.map(id => readMembershipInScope(ctx, { clubId: id }, async scoped => {
    const rows = await listLiveSponsors(scoped, id);
    result.set(id, new Map(rows.filter(s => s.club_id === id).map(s => [s.id, { id: s.id, name: s.name, logo_url: s.logo_url[0] ?? null }])));
  })));
  return result;
}
export function mapLiveReward(r: Awaited<ReturnType<typeof listLiveClubRewards>>[number], sponsorsByClub?: SponsorLookup) {
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
    sponsor_id: r.sponsor_id?.[0] ?? null,
    sponsors: r.sponsor_id?.[0] ? sponsorsByClub?.get(r.club_id)?.get(r.sponsor_id[0]) ?? null : null,
  };
}

/** Active, redeemable (non player-of-match) rewards for the given clubs. */
export async function liveRedeemableRewards(ctx: FeatureBackendContext, clubIds: string[]) {
  // Sponsors only decorate rewards — fetch them alongside, not before.
  const [sponsors, { values: lists }] = await Promise.all([
    rewardSponsorLookup(ctx, clubIds),
    settleAll(
      clubIds.map((id) => readPointsInClub(ctx, id, scoped => listLiveClubRewards(scoped, id, null, true))),
    ),
  ]);
  return lists
    .flat()
    .filter((r) => r.is_active && r.reward_type !== "player_of_match")
    .map(r => mapLiveReward(r, sponsors))
    .sort((a, b) => a.points_required - b.points_required);
}

async function clubNameMap(ctx: FeatureBackendContext, clubIds: string[]) {
  const m = new Map<string, string>();
  await Promise.allSettled(
    clubIds.map(async (id) => {
      const p = await withReadDeadline(readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubProfile(scoped, id)), 'History club name', 4_000);
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
    settleAll(
      clubIds.map((id) =>
        rewardRead(readPointsInClub(ctx, id, scoped => listLivePointsHistory(scoped, id, subjectForUser(userId), 0, limit)), 'Points history'),
      ),
    ).then((r) => r.values),
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
    settleAll(clubIds.flatMap((id) => subjects.map((sub) => readPointsInClub(ctx, id, scoped => listLiveRedemptions(scoped, id, sub))))).then((r) => r.values),
    clubNameMap(ctx, clubIds),
    settleAll(clubIds.map((id) => readPointsInClub(ctx, id, scoped => listLiveClubRewards(scoped, id, null, false)))).then((r) => r.values),
  ]);
  const sponsors = await rewardSponsorLookup(ctx, clubIds);
  const rewardById = new Map(rewards.flat().map((r) => [r.id, mapLiveReward(r, sponsors)]));
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
