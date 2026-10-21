import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClubDispatcher, clearGroupDispatchCache } from './groupDispatch';
import { OFF } from './groupActivation';
import { GROUP_DOMAINS } from './groupRouting';

const ON = { ...OFF, operatorApproved: true, recoveryVerified: true, rehearsalPassed: true, mainnetVerified: true, routedDomains: GROUP_DOMAINS, registryRevision: 1n, approvedRevision: 1n, removalWiring: { revision: 1n, groupIds: ["a"], checkedAtMs: 0 } };
function world(groups: Record<string, string[]>, gates = ON) {
  const ctxs = Object.keys(groups).map(g => ({ group: g, identity: { getPrincipal: () => ({ toText: () => 'p1' }) } }));
  const s = { readClub: vi.fn(), writeClub: vi.fn(), isAssigned: () => false, dispose: vi.fn(),
    readEveryGroup: vi.fn(async (_d: string, r: (c: any) => Promise<any[]>) => (await Promise.all(ctxs.map(r))).flat()) };
  const d = { gates: () => gates, legacy: vi.fn(async (_f: string, _c: string, fn: (c: any) => any) => fn({ group: 'shared' })),
    context: async () => ({ ...(ctxs[0] ?? { identity: { getPrincipal: () => ({ toText: () => 'p1' }) } }),
      target: { alias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet', canisterIds: {} } }), open: vi.fn(async () => s),
    holdsInvite: async (c: any, t: string) => groups[c.group].includes(t) };
  return { d, s };
}
beforeEach(() => clearGroupDispatchCache());

describe('invite routing', () => {
  it('switched off: invites use the shared canisters', async () => {
    const { d } = world({ g1: ['tok'] }, OFF);
    expect(await createClubDispatcher(d as never).forInvite('membership', 'tok', async (c: any) => c.group)).toBe('shared');
    expect(d.open).not.toHaveBeenCalled();
  });
  it('switched on: the call runs only in the group holding the invite', async () => {
    const { d } = world({ g1: [], g2: ['tok'] });
    expect(await createClubDispatcher(d as never).forInvite('membership', 'tok', async (c: any) => c.group)).toBe('g2');
  });
  it('no group holds it: shared canisters (club not moved)', async () => {
    const { d } = world({ g1: [] });
    expect(await createClubDispatcher(d as never).forInvite('membership', 'tok', async (c: any) => c.group)).toBe('shared');
  });
  it('two groups claim it: refused', async () => {
    const { d } = world({ g1: ['tok'], g2: ['tok'] });
    await expect(createClubDispatcher(d as never).forInvite('membership', 'tok', async () => 1)).rejects.toThrow('more than one group');
  });
  it('session reopens after accepting so the new club is routable', async () => {
    const { d, s } = world({ g1: ['tok'] }); const x = createClubDispatcher(d as never);
    await x.forInvite('membership', 'tok', async () => 1);
    expect(s.dispose).toHaveBeenCalled();
  });
  it('league joins execute once on the token-owning group and refresh membership', async () => {
    const { d, s } = world({ g1: [], g2: ['league-token'] });
    const join = vi.fn(async (c: any) => c.group);
    expect(await createClubDispatcher(d as never).forInvite('mini_leagues', 'league-token', join)).toBe('g2');
    expect(join).toHaveBeenCalledTimes(1);
    expect(s.dispose).toHaveBeenCalledTimes(1);
  });
  it('does not execute a league join when token discovery fails', async () => {
    const { d } = world({ g1: [] });
    d.holdsInvite = async () => { throw new Error('Group unavailable'); };
    const join = vi.fn();
    await expect(createClubDispatcher(d as never).forInvite('mini_leagues', 'league-token', join)).rejects.toThrow('Group unavailable');
    expect(join).not.toHaveBeenCalled();
    expect(d.legacy).not.toHaveBeenCalled();
  });
});
