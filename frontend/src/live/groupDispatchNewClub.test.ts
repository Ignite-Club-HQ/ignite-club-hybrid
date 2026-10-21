import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClubDispatcher, clearGroupDispatchCache } from './groupDispatch';
import { OFF } from './groupActivation';
import { GROUP_DOMAINS } from './groupRouting';

const ON = { ...OFF, operatorApproved: true, recoveryVerified: true, rehearsalPassed: true, mainnetVerified: true, routedDomains: GROUP_DOMAINS, registryRevision: 1n, approvedRevision: 1n, removalWiring: { revision: 1n, groupIds: ["a"], checkedAtMs: 0 } };
const ctx = { identity: { getPrincipal: () => ({ toText: () => 'p1' }) }, target: { alias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet', canisterIds: {} } };
function world(placed: string | Error, gates = ON) {
  const s = { readClub: vi.fn(), writeClub: vi.fn(), isAssigned: () => false, dispose: vi.fn(), readEveryGroup: vi.fn(),
    createInGroup: vi.fn(async (p: {groupId: string}, _d: string, w: (c: any) => any) => w({ group: p.groupId })) };
  const d = { gates: () => gates, legacy: vi.fn(async (_f: string, _c: string, fn: (c: any) => any) => fn({ group: 'shared' })),
    context: async () => ctx, open: vi.fn(async () => s),
    placeNewClub: vi.fn(async (_ctx, clubId: string) => { if (placed instanceof Error) throw placed; return { clubId, groupId: placed, revision: 2n }; }) };
  return { d, s };
}
beforeEach(() => clearGroupDispatchCache());

describe('new club placement', () => {
  it('switched off: clubs are created on the shared canisters, no placement asked', async () => {
    const { d } = world('g1', OFF);
    expect(await createClubDispatcher(d as never).forNewClub('membership', 'c1', async (c: any) => c.group)).toBe('shared');
    expect(d.placeNewClub).not.toHaveBeenCalled();
  });
  it('switched on: the club is created once in the group the directory chose', async () => {
    const { d, s } = world('g2');
    expect(await createClubDispatcher(d as never).forNewClub('membership', 'c1', async (c: any) => c.group)).toBe('g2');
    expect(d.placeNewClub).toHaveBeenCalledWith(ctx, 'c1');
    expect(s.createInGroup).toHaveBeenCalledTimes(1);
    expect(s.createInGroup.mock.calls[0][0]).toEqual({ clubId: 'c1', groupId: 'g2', revision: 2n });
    expect(d.placeNewClub.mock.invocationCallOrder[0]).toBeLessThan(d.open.mock.invocationCallOrder[0]);
    expect(s.dispose).toHaveBeenCalled();
  });
  it('placement refused (no room / limit): creation fails, never silently shared', async () => {
    const { d } = world(new Error('No healthy group with capacity'));
    await expect(createClubDispatcher(d as never).forNewClub('membership', 'c1', async () => 1)).rejects.toThrow('capacity');
    expect(d.legacy).not.toHaveBeenCalled();
  });
});
