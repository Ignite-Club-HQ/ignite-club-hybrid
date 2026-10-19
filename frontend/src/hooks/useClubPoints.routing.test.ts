import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ dispatch: vi.fn(), points: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => options }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: state.dispatch }));
vi.mock('@/live/features/points', () => ({
  getLiveUserPoints: state.points, getLiveChildPoints: state.points,
  getLiveChildPointsBatch: vi.fn(), getLiveUserPointsAllClubs: vi.fn(), getLiveChildPointsAllClubs: vi.fn(),
}));
import { useUserClubPoints, useChildClubPoints, useAllUserClubPoints, useAllChildClubPoints } from './useClubPoints';
type Query = { queryFn: () => Promise<unknown> };
beforeEach(() => {
  state.dispatch.mockReset(); state.points.mockReset();
  state.dispatch.mockImplementation(async (_feature, providers, scope) => providers.icp({ club: scope.clubId }));
  state.points.mockImplementation(async (ctx, clubId) => ctx.club === clubId ? 12 : 0);
});
describe('points hook group routing', () => {
  it.each([useUserClubPoints, useChildClubPoints])('uses the requested club for a balance', async hook => {
    const query = hook('subject', 'club-b') as unknown as Query;
    expect(await query.queryFn()).toBe(12);
    expect(state.dispatch).toHaveBeenCalledWith('points', expect.anything(), { clubId: 'club-b' });
  });
  it.each([useAllUserClubPoints, useAllChildClubPoints])('combines clubs without summing duplicate balances', async hook => {
    state.dispatch.mockImplementation(async (_feature, _providers, scope) => {
      expect(scope.everyGroup).toBe(true);
      return scope.merge([[{ club_id: 'a', points: 5 }], [{ club_id: 'a', points: 5 }, { club_id: 'b', points: 12 }]]);
    });
    expect(await (hook('subject') as unknown as Query).queryFn())
      .toEqual([{ club_id: 'a', points: 5 }, { club_id: 'b', points: 12 }]);
  });
  it('does not request a balance without a club', async () => {
    expect(await (useUserClubPoints('subject', null) as unknown as Query).queryFn()).toBe(0);
    expect(state.dispatch).not.toHaveBeenCalled();
  });
});