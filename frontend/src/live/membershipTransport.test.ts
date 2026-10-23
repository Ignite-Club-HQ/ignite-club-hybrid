import { describe, expect, it, vi } from 'vitest';
import { membershipTransport } from './membershipTransport';
import type { GroupSessionTransport } from './groupSession';
import type { DirectoryPage } from './membershipDirectoryDiscovery';

const baseTransport = (): GroupSessionTransport => ({
  readRegistry: vi.fn(),
  readMemberships: vi.fn(),
  readAssignments: vi.fn(),
});

const page = (verifiedCurrent: boolean): DirectoryPage => ({
  caller: 'member', accountVersion: 1n, generation: 1n, directoryRevision: 1n,
  registryFingerprint: 'full-target', instance: 7n, verifiedCurrent,
  assignments: [], legacyClubs: [], next: null,
});

describe('opt-in membership lookup transport', () => {
  it('removes any inherited reader while disabled, keeping Stage A discovery', async () => {
    const inherited: GroupSessionTransport = { ...baseTransport(), readMembershipDirectory: vi.fn(async () => page(true)) };
    const adapted = membershipTransport(inherited, { enabled: false, read: vi.fn() });
    expect(adapted.readMembershipDirectory).toBeUndefined();
    expect(adapted.readRegistry).toBe(inherited.readRegistry);
  });
  it('serves verified-current pages only when explicitly enabled', async () => {
    const read = vi.fn(async () => page(true));
    const adapted = membershipTransport(baseTransport(), { enabled: true, read });
    const result = await adapted.readMembershipDirectory!({} as never, null, 'full-target');
    expect(result.verifiedCurrent).toBe(true);
    expect(read).toHaveBeenCalledWith(expect.anything(), null, 'full-target');
  });
  it('rejects unverified pages and reader failures so callers fall back to Stage A', async () => {
    const unverified = membershipTransport(baseTransport(), { enabled: true, read: vi.fn(async () => page(false)) });
    await expect(unverified.readMembershipDirectory!({} as never, null, 'full-target')).rejects.toThrow('Stage A');
    const failing = membershipTransport(baseTransport(), { enabled: true, read: vi.fn(async () => { throw new Error('Group 2 unavailable'); }) });
    await expect(failing.readMembershipDirectory!({} as never, null, 'full-target')).rejects.toThrow('Group 2 unavailable');
  });
});
