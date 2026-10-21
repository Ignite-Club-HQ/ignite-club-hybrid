import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
const state = vi.hoisted(() => ({ active: true, dispatch: vi.fn() }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: state.active }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => state.active, generalRoutingStatus: async () => ({ active: state.active, missing: [] }), cachedGeneralRoutingActive: () => state.active, clearGeneralRoutingCache: () => {} }));
vi.mock('./featureRouter', () => ({ withFeatureBackend: state.dispatch }));
import { mergeMiniLeagueRows, readMiniLeagueInScope } from './miniLeagueRouting';
const shared = { target: { alias: 'shared' } } as FeatureBackendContext;
beforeEach(() => {
  state.active = true;
  state.dispatch.mockReset();
  state.dispatch.mockImplementation(async (_feature, providers, scope) => providers.icp({ target: { alias: scope.clubId ?? scope.miniLeagueId } }));
});
describe('nested league routing', () => {
  it('reads each club through its own context', async () => {
    expect(await Promise.all(['club-a', 'club-b'].map(clubId => readMiniLeagueInScope(shared, { clubId }, async ctx => ctx.target.alias))))
      .toEqual(['club-a', 'club-b']);
  });
  it('routes an unseen league by its league id', async () => {
    expect(await readMiniLeagueInScope(shared, { miniLeagueId: 'league-b' }, async ctx => ctx.target.alias)).toBe('league-b');
    expect(state.dispatch).toHaveBeenCalledWith('mini_leagues', expect.anything(), { miniLeagueId: 'league-b' });
  });
  it('propagates unavailable groups rather than an empty list', async () => {
    state.dispatch.mockRejectedValue(new Error('Group unavailable'));
    await expect(readMiniLeagueInScope(shared, { clubId: 'club-b' }, async () => [])).rejects.toThrow('Group unavailable');
  });
  it('adds no extra dispatch while shipped routing is off', async () => {
    state.active = false;
    expect(await readMiniLeagueInScope(shared, { clubId: 'club-b' }, async ctx => ctx.target.alias)).toBe('shared');
    expect(state.dispatch).not.toHaveBeenCalled();
  });
  it('drops duplicate league copies without adding tiles', () => {
    expect(mergeMiniLeagueRows([[{ id: 'league-a', club_id: 'club-a' }], [{ id: 'league-a', club_id: 'club-a' }, { id: 'league-b', club_id: 'club-b' }]]))
      .toEqual([{ id: 'league-a', club_id: 'club-a' }, { id: 'league-b', club_id: 'club-b' }]);
  });
  it('rejects copies claiming different clubs', () => {
    expect(() => mergeMiniLeagueRows([[{ id: 'league-a', club_id: 'club-a' }], [{ id: 'league-a', club_id: 'club-b' }]]))
      .toThrow('Conflicting mini-league ownership');
  });
});