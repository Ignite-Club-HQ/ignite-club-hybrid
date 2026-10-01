import type { HomeRewardClub } from "./homeEntitlementRepository";

export type HomeChild = {
  id: string;
  name: string;
  ignite_points: number | null;
};

export async function fetchPendingHomeRedemptions(client: any, userId: string) {
  const { data } = await client
    .from("reward_redemptions")
    .select(`
      id,
      reward_id,
      club_id,
      points_spent,
      status,
      redeemed_at,
      club_rewards (id, name, description, points_required, qr_code_url, show_qr_code),
      clubs!club_id (name)
    `)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("redeemed_at", { ascending: false })
    .limit(1);
  return data ?? [];
}

export async function fetchAvailableHomeRewards(client: any, clubId: string) {
  const { data } = await client
    .from("club_rewards")
    .select("*, sponsors(id, name, logo_url)")
    .eq("club_id", clubId)
    .eq("is_active", true)
    .neq("reward_type", "player_of_match")
    .order("points_required", { ascending: true });
  return data ?? [];
}

export async function fetchNextHomeRewardInfo(
  client: any,
  rewardClubs: readonly Pick<HomeRewardClub, "id" | "hasPro">[],
  isAppAdmin: boolean,
): Promise<{ points_required: number; name: string } | null> {
  const eligibleClubIds = rewardClubs
    .filter((club) => isAppAdmin || club.hasPro)
    .map((club) => club.id);
  if (eligibleClubIds.length === 0) return null;

  const { data } = await client
    .from("club_rewards")
    .select("points_required, name")
    .in("club_id", eligibleClubIds)
    .eq("is_active", true)
    .neq("reward_type", "player_of_match")
    .order("points_required", { ascending: true })
    .limit(1);
  return data?.[0]
    ? { points_required: data[0].points_required, name: data[0].name }
    : null;
}

export async function fetchHomeUserChildren(
  client: any,
  userId: string,
): Promise<HomeChild[]> {
  const ownedPromise = client
    .from("children")
    .select("id, name, ignite_points")
    .eq("parent_id", userId);
  const guardianLinksPromise = client
    .from("child_guardians")
    .select("child_id, children:child_id!inner(id, name, ignite_points)")
    .eq("guardian_id", userId);

  const [{ data: owned }, { data: guardianLinks }] = await Promise.all([
    ownedPromise,
    guardianLinksPromise,
  ]);

  const merged = new Map<string, HomeChild>();
  (owned ?? []).forEach((child: HomeChild) => merged.set(child.id, child));
  (guardianLinks ?? []).forEach((row: { children?: HomeChild | null }) => {
    if (row.children) merged.set(row.children.id, row.children);
  });
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Backend-routed variants (Supabase vs club_points_domain canister).
//
// The plain `fetch*` functions above take a raw Supabase-shaped `client` and
// stay untouched (byte-for-byte) for existing Supabase call sites/tests. The
// functions below are the `withFeatureBackend("points", ...)` entry points
// Home should call instead so the "points" feature area can be routed to the
// club_points_domain canister without touching the Supabase branch.
// ---------------------------------------------------------------------------

import { withFeatureBackend, type FeatureBackendContext } from "@/live/featureRouter";
import { listLiveClubRewards } from "@/live/features/points";

export type HomeRewardRow = {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  points_required: number;
  reward_type: string;
  is_active: boolean;
  qr_code_url: string | null;
  show_qr_code: boolean;
  logo_url: string | null;
  // PROVISIONAL: `sponsors` is a Supabase-only join (sponsor name/logo). The
  // canister's `ClubReward` only carries `sponsor_id` — no joined sponsor
  // record exists there, so ICP-routed rewards render without a sponsor
  // badge rather than inventing a name.
  sponsors?: { id: string; name: string; logo_url: string | null } | null;
};

/**
 * Active, redeemable (non player-of-match) rewards for a single club.
 */
export async function fetchAvailableHomeRewardsForBackend(
  client: any,
  ctx: FeatureBackendContext | null,
  clubId: string,
): Promise<HomeRewardRow[]> {
  return withFeatureBackend("points", {
    supabase: async () => fetchAvailableHomeRewards(client, clubId),
    icp: async (icpCtx) => {
      const rewards = await listLiveClubRewards(icpCtx, clubId, null, true);
      return rewards
        .filter((r) => r.reward_type !== "player_of_match")
        .sort((a, b) => a.points_required - b.points_required)
        .map((r) => ({
          id: r.id,
          club_id: r.club_id,
          name: r.name,
          description: r.description[0] ?? null,
          points_required: r.points_required,
          reward_type: r.reward_type,
          is_active: r.is_active,
          qr_code_url: r.qr_code_url[0] ?? null,
          show_qr_code: r.show_qr_code,
          logo_url: r.logo_url[0] ?? null,
          // No canister-side sponsor join — see HomeRewardRow doc comment.
          sponsors: null,
        }));
    },
  });
}

/**
 * Lowest-points-required reward across a set of eligible clubs. Unlike
 * `list_rewards`' single-club scope, this needs one canister call per club —
 * still possible (just not a single bulk query) since each club id is known
 * up front; this is NOT the unsupported "cross-club bulk by row id" case.
 */
export async function fetchNextHomeRewardInfoForBackend(
  client: any,
  ctx: FeatureBackendContext | null,
  eligibleClubIds: string[],
): Promise<{ points_required: number; name: string } | null> {
  if (eligibleClubIds.length === 0) return null;
  return withFeatureBackend("points", {
    supabase: async () =>
      fetchNextHomeRewardInfo(
        client,
        eligibleClubIds.map((id) => ({ id, hasPro: true })),
        true,
      ),
    icp: async (icpCtx) => {
      const perClub = await Promise.all(
        eligibleClubIds.map((clubId) => listLiveClubRewards(icpCtx, clubId, null, true)),
      );
      const candidates = perClub
        .flat()
        .filter((r) => r.reward_type !== "player_of_match")
        .sort((a, b) => a.points_required - b.points_required);
      return candidates[0] ? { points_required: candidates[0].points_required, name: candidates[0].name } : null;
    },
  });
}

/**
 * Most recent pending redemption for the signed-in user, used to drive the
 * "ready to claim" Home banner.
 *
 * PROVISIONAL: `list_redemptions` requires an explicit club_id — there is no
 * canister equivalent of "this user's latest pending redemption across every
 * club". Per the documented bulk-lookup limitation, the ICP branch returns
 * no pending redemption rather than guessing a club or falling back to
 * Supabase while the feature is routed to ICP.
 */
export async function fetchPendingHomeRedemptionsForBackend(
  client: any,
  ctx: FeatureBackendContext | null,
  userId: string,
): Promise<ReturnType<typeof fetchPendingHomeRedemptions> extends Promise<infer T> ? T : never> {
  return withFeatureBackend("points", {
    supabase: async () => fetchPendingHomeRedemptions(client, userId),
    icp: async () => [],
  });
}
