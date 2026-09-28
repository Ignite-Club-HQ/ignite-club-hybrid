import type { Principal } from '@icp-sdk/core/principal';
import { withClubBackend } from './backendRouter';
import type { PlacementRegistry } from './hybridClubLinksService';

export type HomeChild = {
  id: string;
  name: string;
  ignite_points: number | null;
};

export type ClubReward = {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  points_required: number;
  reward_type: string;
  is_active: boolean;
  qr_code_url: string | null;
  show_qr_code: boolean;
  sponsors?: { id: string; name: string; logo_url: string | null } | null;
  [key: string]: unknown;
};

export type PendingRewardRedemption = {
  id: string;
  reward_id: string;
  club_id: string;
  points_spent: number;
  status: string;
  redeemed_at: string;
  club_rewards?: {
    id: string;
    name: string;
    description: string | null;
    points_required: number;
    qr_code_url: string | null;
    show_qr_code: boolean;
  } | null;
  clubs?: { name: string } | null;
  [key: string]: unknown;
};

export type HomeRewardClub = {
  id: string;
  name: string;
  logo_url: string | null;
  hasPro: boolean;
};

export type HomeRewardEligibleClub = Pick<HomeRewardClub, 'id' | 'hasPro'>;

export type NextHomeRewardInfo = {
  points_required: number;
  name: string;
};

/**
 * Provider interface for querying available rewards and pending redemptions
 * for a club backend.
 */
export interface HomeRewardsProvider {
  listAvailableRewards(clubId: string): Promise<ClubReward[]>;
}

export type HomeRewardsProviders = {
  icp: (canister: Principal) => Promise<HomeRewardsProvider>;
  supabase: (environment: string) => Promise<HomeRewardsProvider>;
};

/**
 * Inspectable outcome of one club's available reward lookup. `'ok'` carries
 * the active rewards for that club; `'unavailable'` carries the causing error
 * so Home can surface a degraded notice for that club without failing the
 * entire dashboard or falling back to Supabase in ICP mode.
 */
export type HomeRewardsGroupOutcome =
  | { status: 'ok'; rewards: ClubReward[] }
  | { status: 'unavailable'; error: unknown };

export type HomeRewardsFetchResult = {
  rewardsByClub: Record<string, ClubReward[]>;
  groups: Record<string, HomeRewardsGroupOutcome>;
};

/**
 * Read active rewards for a single club from its backend provider.
 */
export async function fetchAvailableHomeRewardsForClub(
  provider: HomeRewardsProvider,
  clubId: string,
): Promise<ClubReward[]> {
  if (!clubId) return [];
  return provider.listAvailableRewards(clubId);
}

/**
 * Pure selection helper: computes the next available reward threshold and
 * name across all eligible Pro clubs (or all clubs for app admins),
 * choosing the reward with the lowest `points_required`.
 */
export function selectNextHomeRewardInfo(
  rewardsByClub: Record<string, readonly ClubReward[]>,
  eligibleClubs: readonly HomeRewardEligibleClub[],
  isAppAdmin: boolean,
): NextHomeRewardInfo | null {
  const eligibleClubIds = new Set(
    eligibleClubs
      .filter(club => isAppAdmin || club.hasPro)
      .map(club => club.id),
  );

  if (eligibleClubIds.size === 0) return null;

  const candidateRewards: ClubReward[] = [];
  for (const clubId of eligibleClubIds) {
    const rewards = rewardsByClub[clubId] ?? [];
    for (const reward of rewards) {
      if (reward.is_active && reward.reward_type !== 'player_of_match') {
        candidateRewards.push(reward);
      }
    }
  }

  if (candidateRewards.length === 0) return null;

  candidateRewards.sort((a, b) => {
    if (a.points_required !== b.points_required) {
      return a.points_required - b.points_required;
    }
    return a.name.localeCompare(b.name);
  });

  const next = candidateRewards[0];
  return {
    points_required: next.points_required,
    name: next.name,
  };
}

/**
 * Pure merge helper: combines owned and guardian-linked child records,
 * de-duplicates by child id, and sorts alphabetically by name.
 */
export function mergeHomeUserChildren(
  owned: readonly HomeChild[] | null | undefined,
  guardianLinks: readonly { children?: HomeChild | null }[] | null | undefined,
): HomeChild[] {
  const merged = new Map<string, HomeChild>();
  (owned ?? []).forEach(child => {
    if (child?.id) merged.set(child.id, child);
  });
  (guardianLinks ?? []).forEach(row => {
    if (row?.children?.id) merged.set(row.children.id, row.children);
  });
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Placement-routed adaptation of Home reward reads: resolves each club's
 * authoritative backend and caches one provider per backend identity,
 * mirroring every other hybrid service in this lab. An unavailable/disabled
 * backend surfaces its reason with no Supabase fallback in ICP mode.
 */
export function createHybridHomeRewardsRepository(
  registry: PlacementRegistry,
  providers: HomeRewardsProviders,
) {
  const clients = new Map<string, HomeRewardsProvider>();

  const providerFor = async (clubId: string): Promise<HomeRewardsProvider> => {
    const key = `club:${clubId}`;
    const existing = clients.get(key);
    if (existing) return existing;

    const provider = await withClubBackend(registry, providers, clubId, async value => value);
    clients.set(key, provider);
    return provider;
  };

  return {
    async fetchAvailableRewards(clubId: string): Promise<ClubReward[]> {
      const provider = await providerFor(clubId);
      return fetchAvailableHomeRewardsForClub(provider, clubId);
    },

    async fetchRewardsAcrossClubs(
      clubIds: readonly string[],
    ): Promise<HomeRewardsFetchResult> {
      const rewardsByClub: Record<string, ClubReward[]> = {};
      const groups: Record<string, HomeRewardsGroupOutcome> = {};

      for (const clubId of clubIds) {
        if (!clubId) continue;
        try {
          const provider = await providerFor(clubId);
          const rewards = await fetchAvailableHomeRewardsForClub(provider, clubId);
          groups[clubId] = { status: 'ok', rewards };
          rewardsByClub[clubId] = rewards;
        } catch (error) {
          groups[clubId] = { status: 'unavailable', error };
        }
      }

      return { rewardsByClub, groups };
    },

    async fetchNextRewardInfo(
      rewardClubs: readonly HomeRewardEligibleClub[],
      isAppAdmin: boolean,
    ): Promise<NextHomeRewardInfo | null> {
      const eligibleClubIds = rewardClubs
        .filter(club => isAppAdmin || club.hasPro)
        .map(club => club.id);

      if (eligibleClubIds.length === 0) return null;

      const { rewardsByClub } = await this.fetchRewardsAcrossClubs(eligibleClubIds);
      return selectNextHomeRewardInfo(rewardsByClub, rewardClubs, isAppAdmin);
    },

    clearProviderCache() {
      clients.clear();
    },
  };
}
