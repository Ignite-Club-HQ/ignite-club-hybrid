import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rewards: vi.fn(), history: vi.fn(), redemptions: vi.fn(), profile: vi.fn(), settings: vi.fn() }));
vi.mock('@/live/pointsRouting', () => ({ readPointsInClub: async (_ctx: unknown, id: string, read: (ctx: unknown) => unknown) => read({ club: id }) }));
vi.mock('@/live/membershipRouting', () => ({ readMembershipInScope: async (_ctx: unknown, scope: { clubId?: string; teamId?: string }, read: (ctx: unknown) => unknown) => read({ club: scope.clubId, team: scope.teamId }) }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: async () => [{ club: ['club-a'], team: [] }, { club: ['club-b'], team: [] }] }));
vi.mock('@/live/features/club', () => ({
  getLiveClubProfile: (...args: unknown[]) => state.profile(...args),
  getLiveTeam: vi.fn(), isLiveClubPro: async () => true,
  listLiveSponsors: async (ctx: { club: string }, id: string) => [{ id: `sponsor-${id}`, club_id: id, name: ctx.club, logo_url: [] }],
}));
vi.mock('@/live/features/points', () => ({
  getLiveClubPointsSettings: (...args: unknown[]) => state.settings(...args), listLiveClubRewards: state.rewards,
  listLivePointsHistory: state.history, listLiveRedemptions: state.redemptions,
  subjectForUser: (id: string) => ({ user: id }), subjectForChild: (id: string) => ({ child: id }),
}));
import { liveRedeemableRewards, liveRewardClubs, liveMyPointsHistory, liveMyRedemptions } from './icpRewardsReads';
import type { FeatureBackendContext } from '@/live/featureRouter';
const shared = {} as FeatureBackendContext;
beforeEach(() => {
  state.profile.mockReset().mockImplementation(async (ctx: { club: string }, id: string) => ctx.club === id ? [{ name: id, logo_url: [] }] : []);
  state.settings.mockReset().mockResolvedValue({});
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
  it('reveals verified reward clubs when display settings stall', async () => {
    vi.useFakeTimers();
    try {
      state.settings.mockReturnValue(new Promise(() => {}));
      const pending = liveRewardClubs(shared, ['club-a']);
      await vi.advanceTimersByTimeAsync(4_001);
      const rows = await pending;
      expect(rows[0].id).toBe('club-a');
      expect(rows[0].hasPro).toBe(true);
      expect(rows[0].points_display_name).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('reveals authorized points history despite failed club-name hydration', async () => {
    state.profile.mockRejectedValue(new Error('Name unavailable'));
    const rows = await liveMyPointsHistory(shared, 'user', 'club-a');
    expect(rows[0].amount).toBe(5);
    expect(rows[0].clubs).toBeNull();
  });
  it('retains healthy history when another club read stalls', async () => {
    vi.useFakeTimers();
    try {
      state.history.mockImplementation(async (_ctx, id) => id === 'club-b' ? new Promise(() => {})
        : { items: [{ id, club_id: id, amount: 5, source_id: [], created_at_ms: 1000n }] });
      const pending = liveMyPointsHistory(shared, 'user', null);
      await vi.advanceTimersByTimeAsync(12_001);
      expect((await pending).map(row => row.club_id)).toEqual(['club-a']);
    } finally { vi.useRealTimers(); }
  });
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
  it('keeps the healthy clubs when one club read fails', async () => {
    state.history.mockImplementation(async (ctx, id) => {
      if (id === 'club-b') throw new Error('group unavailable');
      return { items: [{ id, club_id: id, amount: 5, source_id: [], created_at_ms: 1000n }] };
    });
    expect((await liveMyPointsHistory(shared, 'user', null)).map(r => r.club_id)).toEqual(['club-a']);
  });
  it('still fails when every club read fails', async () => {
    state.history.mockRejectedValue(new Error('group unavailable'));
    await expect(liveMyPointsHistory(shared, 'user', null)).rejects.toThrow('group unavailable');
  });
});