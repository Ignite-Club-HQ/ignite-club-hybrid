import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ dispatch: vi.fn(), redemptions: vi.fn(), rewards: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: state.dispatch }));
vi.mock('@/live/pointsRouting', () => ({ readPointsInClub: async (_ctx: unknown, id: string, read: (ctx: unknown) => unknown) => read({ club: id }) }));
vi.mock('@/lib/icpRewardsReads', () => ({ liveMyRedemptions: state.redemptions }));
vi.mock('@/live/features/points', () => ({ listLiveClubRewards: state.rewards }));
import { fetchPendingHomeRedemptionsForBackend, fetchNextHomeRewardInfoForBackend } from './homeRewardsRepository';
beforeEach(() => {
  state.dispatch.mockReset(); state.redemptions.mockReset(); state.rewards.mockReset();
  state.dispatch.mockImplementation(async (_feature, providers) => providers.icp({}));
});
describe('home rewards across groups', () => {
  it('shows only the most recent pending claim across clubs', async () => {
    state.redemptions.mockResolvedValue([
      { id: 'old', status: 'pending', redeemed_at: '2026-10-17T00:00:00Z' },
      { id: 'claimed', status: 'fulfilled', redeemed_at: '2026-10-19T00:00:00Z' },
      { id: 'latest', club_id: 'club-b', status: 'pending', redeemed_at: '2026-10-18T00:00:00Z' },
    ]);
    expect(await fetchPendingHomeRedemptionsForBackend({}, null, 'user'))
      .toEqual([{ id: 'latest', club_id: 'club-b', status: 'pending', redeemed_at: '2026-10-18T00:00:00Z' }]);
    expect(state.redemptions).toHaveBeenCalledWith({}, 'user', null);
  });
  it('reads each eligible club in its own group and chooses the lowest threshold', async () => {
    state.rewards.mockImplementation(async (ctx, id) => {
      if (ctx.club !== id) throw new Error('wrong group');
      return [{ name: id, points_required: id === 'club-b' ? 20 : 50, reward_type: 'standard' }];
    });
    expect(await fetchNextHomeRewardInfoForBackend({}, null, ['club-a', 'club-b', 'club-a']))
      .toEqual({ name: 'club-b', points_required: 20 });
    expect(state.rewards).toHaveBeenCalledTimes(2);
  });
  it('does not convert unavailable claims to an empty banner', async () => {
    state.redemptions.mockRejectedValue(new Error('group unavailable'));
    await expect(fetchPendingHomeRedemptionsForBackend({}, null, 'user')).rejects.toThrow('group unavailable');
  });
});