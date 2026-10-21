import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ active: true, dispatch: vi.fn() }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: state.active }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => state.active, generalRoutingStatus: async () => ({ active: state.active, missing: [] }), cachedGeneralRoutingActive: () => state.active, clearGeneralRoutingCache: () => {} }));
import { createContentReader } from './contentRouting';
const readContentInScope = createContentReader(() => state.active, async () => state.dispatch);
describe('club content routing', () => {
  beforeEach(() => { state.active = true; state.dispatch.mockReset(); });
  it('loads two clubs using separate group contexts', async () => {
    state.dispatch.mockImplementation(async (_feature, providers, scope) => providers.icp({ target: { alias: scope.clubId } }));
    const result = await Promise.all(['club-a', 'club-b'].map(clubId => readContentInScope({} as never, 'media', { clubId }, async ctx => ctx.target.alias)));
    expect(result).toEqual(['club-a', 'club-b']);
    expect(state.dispatch).toHaveBeenCalledTimes(2);
  });
  it('propagates group failures instead of returning empty content', async () => {
    state.dispatch.mockRejectedValue(new Error('group unavailable'));
    await expect(readContentInScope({} as never, 'news', { clubId: 'club-a' }, async () => [])).rejects.toThrow('group unavailable');
  });
  it('preserves the current context with routing off', async () => {
    state.active = false;
    const context = {} as never;
    expect(await readContentInScope(context, 'home', { clubId: 'club-a' }, async ctx => ctx)).toBe(context);
    expect(state.dispatch).not.toHaveBeenCalled();
  });
});