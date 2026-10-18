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
