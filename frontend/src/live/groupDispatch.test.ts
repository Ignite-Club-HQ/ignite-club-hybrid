import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClubDispatcher, clearGroupDispatchCache, clubDispatch } from './groupDispatch';
import { OFF } from './groupActivation';
import { GROUP_DOMAINS } from './groupRouting';

const ON = { ...OFF, operatorApproved: true, recoveryVerified: true, rehearsalPassed: true, mainnetVerified: true, routedDomains: GROUP_DOMAINS, registryRevision: 1n, approvedRevision: 1n };
function deps(gates = OFF, principal = 'p1') {
  const session = { readClub: vi.fn(async () => 'group'), writeClub: vi.fn(async () => 'group'), isAssigned: (c: string) => c === 'moved', dispose: vi.fn() };
  const d = { gates: () => gates, legacy: vi.fn(async () => 'legacy') as never,
    context: async () => ({ identity: { getPrincipal: () => ({ toText: () => principal }) } }) as never, open: vi.fn(async () => session) };
  return { d, session };
}
beforeEach(() => clearGroupDispatchCache());

describe('club-scoped dispatcher', () => {
  it('switched off: always the shared canisters, never opens a group session', async () => {
    const { d } = deps(); const x = createClubDispatcher(d);
    expect(await x.read('events', 'moved', 'events_domain', async () => 'r')).toBe('legacy');
    expect(await x.write('events', 'moved', 'events_domain', 'k', async () => 'w')).toBe('legacy');
    expect(d.open).not.toHaveBeenCalled();
  });
  it('switched on: moved clubs go to their group, unmoved clubs stay on the shared canisters', async () => {
    const { d, session } = deps(ON); const x = createClubDispatcher(d);
    expect(await x.read('events', 'moved', 'events_domain', async () => 'r')).toBe('group');
    expect(await x.write('events', 'moved', 'events_domain', 'k', async () => 'w', 1)).toBe('group');
    expect(session.writeClub).toHaveBeenCalledWith('moved', 'events_domain', 'k', expect.any(Function), 1);
    expect(await x.read('events', 'legacy-club', 'events_domain', async () => 'r')).toBe('legacy');
    expect(d.open).toHaveBeenCalledTimes(1);
  });
  it('a group failure is reported, never retried on the shared canisters', async () => {
    const { d, session } = deps(ON); session.readClub.mockRejectedValueOnce(new Error('Request timed out'));
    await expect(createClubDispatcher(d).read('events', 'moved', 'events_domain', async () => 'r')).rejects.toThrow('timed out');
    expect(d.legacy).not.toHaveBeenCalled();
  });
  it('a different signed-in person gets a fresh session', async () => {
    const a = deps(ON, 'p1'); await createClubDispatcher(a.d).read('events', 'moved', 'events_domain', async () => 1);
    const b = deps(ON, 'p2'); await createClubDispatcher(b.d).read('events', 'moved', 'events_domain', async () => 1);
    expect(a.session.dispose).toHaveBeenCalled(); expect(b.d.open).toHaveBeenCalledTimes(1);
  });
  it('the shipped dispatcher is switched off', async () => {
    await expect(clubDispatch.read('events', 'x', 'events_domain', async () => 1)).rejects.toThrow(); // legacy path: no session in tests
  });
});

describe('entity scopes', () => {
  function world(claims: Record<string, string[]>) {
    const { d, session } = deps(ON);
    const s2 = { ...session, readEveryGroup: vi.fn(async (_d: string, r: (ctx: never) => Promise<string[]>) => (await Promise.all(Object.keys(claims).map(g => r(g as never)))).flat()) };
    const d2 = { ...d, open: vi.fn(async () => s2), lookup: vi.fn(async (g: unknown, _k: string, id: string) => (claims[g as string] ?? []).includes(id) ? (id.startsWith('m') ? 'moved' : 'legacy-club') : null) };
    return { d: d2, s: s2 };
  }
  it('an event in a moved club routes to that group, and the lookup is cached', async () => {
    const { d, s } = world({ g1: ['m-ev'], g2: [] }); const x = createClubDispatcher(d as never);
    expect(await x.readFor('events', { eventId: 'm-ev' }, 'events_domain', async () => 1)).toBe('group');
    await x.readFor('events', { eventId: 'm-ev' }, 'events_domain', async () => 1);
    expect(s.readEveryGroup).toHaveBeenCalledTimes(1); expect(s.readClub).toHaveBeenCalledWith('moved', 'events_domain', expect.any(Function));
  });
  it('an event no group holds stays on the shared canisters', async () => {
    const { d } = world({ g1: [] });
    expect(await createClubDispatcher(d as never).readFor('events', { eventId: 'x' }, 'events_domain', async () => 1)).toBe('legacy');
  });
  it('an event claimed by two groups is refused', async () => {
    const { d } = world({ g1: ['m-ev'], g2: ['m-ev'] }); (d.lookup as ReturnType<typeof vi.fn>).mockImplementation(async (g: unknown) => g === 'g1' ? 'moved' : 'other');
    await expect(createClubDispatcher(d as never).readFor('events', { eventId: 'm-ev' }, 'events_domain', async () => 1)).rejects.toThrow('more than one group');
  });
  it('two screens asking about the same event at once share one lookup', async () => {
    const { d, s } = world({ g1: ['m-ev'] }); const x = createClubDispatcher(d as never);
    await Promise.all([1, 2, 3].map(() => x.readFor('events', { eventId: 'm-ev' }, 'events_domain', async () => 1)));
    expect(s.readEveryGroup).toHaveBeenCalledTimes(1);
  });
  it('a remembered answer survives an app restart, so no lookup is needed', async () => {
    const saved: Record<string, Record<string, string>> = {};
    const store = { load: (p: string) => saved[p] ?? {}, save: (p: string, o: Record<string, string>) => { saved[p] = o; } };
    const a = world({ g1: ['m-ev'] }); await createClubDispatcher({ ...a.d, store } as never).readFor('events', { eventId: 'm-ev' }, 'events_domain', async () => 1);
    clearGroupDispatchCache();
    const b = world({ g1: ['m-ev'] }); await createClubDispatcher({ ...b.d, store } as never).readFor('events', { eventId: 'm-ev' }, 'events_domain', async () => 1);
    expect(b.s.readEveryGroup).not.toHaveBeenCalled(); expect(b.s.readClub).toHaveBeenCalledWith('moved', 'events_domain', expect.any(Function));
  });
  it('"not in any group" is never kept on the device (the club may move later)', async () => {
    const saved: Record<string, Record<string, string>> = {};
    const store = { load: (p: string) => saved[p] ?? {}, save: (p: string, o: Record<string, string>) => { saved[p] = o; } };
    const a = world({ g1: [] }); await createClubDispatcher({ ...a.d, store } as never).readFor('events', { eventId: 'x' }, 'events_domain', async () => 1);
    expect(saved.p1?.['event:x']).toBeUndefined();
  });
  it('items a list already loaded open without a lookup', async () => {
    const { d, s } = world({ g1: [] }); const x = createClubDispatcher(d as never);
    await x.remember('event', [['m-ev', 'moved']]);
    expect(await x.readFor('events', { eventId: 'm-ev' }, 'events_domain', async () => 1)).toBe('group');
    expect(s.readEveryGroup).not.toHaveBeenCalled();
  });
});

describe('lists spanning several clubs', () => {
  it('switched off: asks only the shared canisters', async () => {
    const { d } = deps(); const x = createClubDispatcher(d);
    expect(await x.readAcross('events', 'events_domain', async () => ['a'], (p: string[][]) => p.flat())).toEqual(['legacy']);
    expect(d.open).not.toHaveBeenCalled();
  });
  it('switched on: shared canisters and every group are combined', async () => {
    const { d, session } = deps(ON);
    const s2 = { ...session, readEveryGroup: vi.fn(async (_d: string, r: (ctx: never) => Promise<string[]>) => (await Promise.all(['g1', 'g2'].map(g => r(g as never)))).flat()) };
    const x = createClubDispatcher({ ...d, open: vi.fn(async () => s2) } as never);
    const out = await x.readAcross('events', 'events_domain', async (ctx: unknown) => `from-${String(ctx)}`, (p: string[]) => p);
    expect(out).toEqual(['legacy', 'from-g1', 'from-g2']);
  });
});

describe('membership entity routing', () => {
  it.each([
    ['clubLink', { clubLinkId: 'link-a' }],
    ['roleRequest', { roleRequestId: 'request-a' }],
  ] as const)('routes %s writes once to the verified owner', async (kind, scope) => {
    const { d, session } = deps(ON);
    const s = { ...session, readEveryGroup: vi.fn(async (_domain, read) => read({} as never)) };
    const lookup = vi.fn(async () => 'moved');
    const dispatcher = createClubDispatcher({ ...d, open: async () => s, lookup } as never);
    expect(await dispatcher.writeFor('membership', scope, 'club_domain', 'once', async () => 'saved', 1)).toBe('group');
    expect(lookup).toHaveBeenCalledWith(expect.anything(), kind, kind === 'clubLink' ? 'link-a' : 'request-a');
    expect(session.writeClub).toHaveBeenCalledWith('moved', 'club_domain', 'once', expect.any(Function), 1);
    expect(d.legacy).not.toHaveBeenCalled();
  });
});
