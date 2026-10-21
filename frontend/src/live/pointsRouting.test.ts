import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
const state = vi.hoisted(() => ({ active: true, dispatch: vi.fn() }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: state.active }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => state.active, generalRoutingStatus: async () => ({ active: state.active, missing: [] }), cachedGeneralRoutingActive: () => state.active, clearGeneralRoutingCache: () => {} }));
vi.mock('./featureRouter', () => ({ withFeatureBackend: state.dispatch }));
import { readPointsInClub } from './pointsRouting';
const shared = { target: { alias: 'shared' } } as unknown as FeatureBackendContext;
beforeEach(() => {
  state.active = true;
  state.dispatch.mockReset();
  state.dispatch.mockImplementation(async (_feature, providers, scope) => providers.icp({ target: { alias: scope.clubId } }));
});
describe('per-club points reads', () => {
  it('resolves each club separately instead of reusing the shared context', async () => {
    expect(await Promise.all(['club-a', 'club-b'].map(id => readPointsInClub(shared, id, async ctx => ctx.target.alias))))
      .toEqual(['club-a', 'club-b']);
    expect(state.dispatch).toHaveBeenCalledWith('points', expect.anything(), { clubId: 'club-b' });
  });
  it('does not hide failed club reads as an empty reward list', async () => {
    state.dispatch.mockRejectedValue(new Error('membership denied'));
    await expect(readPointsInClub(shared, 'club-b', async () => [])).rejects.toThrow('membership denied');
  });
  it('rejects missing club ownership without dispatch', async () => {
    await expect(readPointsInClub(shared, '', async () => [])).rejects.toThrow('Reward club is missing');
    expect(state.dispatch).not.toHaveBeenCalled();
  });
  it('keeps the shipped inactive path free of extra dispatch', async () => {
    state.active = false;
    expect(await readPointsInClub(shared, 'club-a', async ctx => ctx.target.alias)).toBe('shared');
    expect(state.dispatch).not.toHaveBeenCalled();
  });
});