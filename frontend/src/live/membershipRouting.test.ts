import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ active: false, dispatch: vi.fn() }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: state.active }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => state.active, generalRoutingStatus: async () => ({ active: state.active, missing: [] }), cachedGeneralRoutingActive: () => state.active, clearGeneralRoutingCache: () => {} }));
vi.mock('./featureRouter', () => ({ withFeatureBackend: state.dispatch }));
import { readMembershipInScope } from './membershipRouting';

describe('resource-scoped membership reads', () => {
  it('adds no dispatch while routing is off', async () => {
    state.active = false; state.dispatch.mockClear();
    const context = {} as never;
    const read = vi.fn(async () => 'a');
    expect(await readMembershipInScope(context, { clubId: 'a' }, read)).toBe('a');
    expect(read).toHaveBeenCalledWith(context);
    expect(state.dispatch).not.toHaveBeenCalled();
  });
  it('routes two clubs independently when on', async () => {
    state.active = true; state.dispatch.mockReset();
    state.dispatch.mockImplementation(async (_f, providers, scope) => providers.icp({ club: scope.clubId }));
    const read = async (ctx: any) => ctx.club;
    expect(await Promise.all(['a', 'b'].map(clubId => readMembershipInScope({} as never, { clubId }, read)))).toEqual(['a', 'b']);
    expect(state.dispatch.mock.calls.map(c => c[2])).toEqual([{ clubId: 'a' }, { clubId: 'b' }]);
  });
});