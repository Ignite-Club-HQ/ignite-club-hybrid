import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rewards: vi.fn(), history: vi.fn(), redemptions: vi.fn() }));
vi.mock('@/live/pointsRouting', () => ({ readPointsInClub: async (_ctx: unknown, id: string, read: (ctx: unknown) => unknown) => read({ club: id }) }));
vi.mock('@/live/membershipRouting', () => ({ readMembershipInScope: async (_ctx: unknown, scope: { clubId?: string; teamId?: string }, read: (ctx: unknown) => unknown) => read({ club: scope.clubId, team: scope.teamId }) }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: async () => [{ club: ['club-a'], team: [] }, { club: ['club-b'], team: [] }] }));
vi.mock('@/live/features/club', () => ({
  getLiveClubProfile: async (ctx: { club: string }, id: string) => ctx.club === id ? [{ name: id, logo_url: [] }] : [],
  getLiveTeam: vi.fn(), isLiveClubPro: async () => true,
}));
vi.mock('@/live/features/points', () => ({
  getLiveClubPointsSettings: async () => ({}), listLiveClubRewards: state.rewards,
  listLivePointsHistory: state.history, listLiveRedemptions: state.redemptions,
  subjectForUser: (id: string) => ({ user: id }), subjectForChild: (id: string) => ({ child: id }),
}));
import { liveRedeemableRewards, liveRewardClubs, liveMyPointsHistory, liveMyRedemptions } from './icpRewardsReads';
import type { FeatureBackendContext } from '@/live/featureRouter';
const shared = {} as FeatureBackendContext;
beforeEach(() => {
  state.rewards.mockReset(); state.history.mockReset(); state.redemptions.mockReset();
  state.rewards.mockImplementation(async (ctx, id) => {
    if (ctx.club !== id) throw new Error('wrong group');
    return [{ id: `reward-${id}`, club_id: id, name: id, points_required: id === 'club-a' ? 10 : 20,
      reward_type: 'standard', is_active: true, description: [], logo_url: [], qr_code_url: [] }];
  });
  state.history.mockImplementation(async (ctx, id) => {
    if (ctx.club !== id) throw new Error('wrong group');
    return { items: [{ id, club_id: id, amount: 5, source_id: [], created_at_ms: 1000n }] };
  });
  state.redemptions.mockImplementation(async (ctx, id) => {
    if (ctx.club !== id) throw new Error('wrong group');
    return [{ id, club_id: id, reward_id: `reward-${id}`, child_id: [], redeemed_at_ms: [], created_at_ms: 1000n }];
  });
});
describe('cross-club rewards', () => {
  it('loads each catalog and club metadata from its own group', async () => {
    expect((await liveRedeemableRewards(shared, ['club-a', 'club-b'])).map(r => r.id))
      .toEqual(['reward-club-a', 'reward-club-b']);
    expect((await liveRewardClubs(shared, ['club-a', 'club-b'])).map(r => r.name)).toEqual(['club-a', 'club-b']);
  });
  it('joins history and redemption names without reusing another club context', async () => {
    expect((await liveMyPointsHistory(shared, 'user', null)).map(r => r.clubs?.name)).toEqual(['club-a', 'club-b']);
    expect((await liveMyRedemptions(shared, 'user', null)).map(r => r.club_rewards?.id))
      .toEqual(['reward-club-a', 'reward-club-b']);
  });
  it('propagates a failed catalog instead of silently omitting a club', async () => {
    state.rewards.mockRejectedValue(new Error('group unavailable'));
    await expect(liveRedeemableRewards(shared, ['club-b'])).rejects.toThrow('group unavailable');
  });
});