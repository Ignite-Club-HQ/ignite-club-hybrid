import { describe, expect, it, vi } from 'vitest';
import { readCompleteMembershipDirectory, type DirectoryPage } from './membershipDirectoryDiscovery';
const page = (overrides: Partial<DirectoryPage> = {}): DirectoryPage => ({
  caller: 'member', accountVersion: 1n, generation: 1n, directoryRevision: 1n,
  registryFingerprint: 'full-target', verifiedCurrent: true, assignments: [], legacyClubs: [], next: null, ...overrides,
});
describe('complete caller-private membership directory', () => {
  it('reads a single-group account once and deduplicates linked aliases across pages', async () => {
    const read = vi.fn(async (sequence: bigint) => page({ assignments: [{ clubId: 'club-a', groupId: 'g1', revision: 1n }], next: sequence === 0n ? 1n : null }));
    const result = await readCompleteMembershipDirectory('member', 'full-target', read, () => {});
    expect(result.assignments).toEqual([{ clubId: 'club-a', groupId: 'g1', revision: 1n }]);
    expect(read.mock.calls.map(([n]) => n)).toEqual([0n, 1n]);
  });
  it('keeps memberships from both groups without treating a partial page as complete', async () => {
    const result = await readCompleteMembershipDirectory('member', 'full-target', async sequence => page({ assignments: [{ clubId: sequence === 0n ? 'club-a' : 'club-b', groupId: sequence === 0n ? 'g1' : 'g2', revision: 1n }], next: sequence === 0n ? 1n : null }), () => {});
    expect(result.assignments.map(row => row.groupId)).toEqual(['g1', 'g2']);
    await expect(readCompleteMembershipDirectory('member', 'full-target', async sequence => page({ verifiedCurrent: sequence === 0n, next: sequence === 0n ? 1n : null }), () => {})).rejects.toThrow('incomplete');
  });
  it('rejects caller, target, version and future-page substitution', async () => {
    for (const overrides of [{ caller: 'other' }, { registryFingerprint: 'foreign' }, { accountVersion: 0n }, { next: 2n }]) {
      await expect(readCompleteMembershipDirectory('member', 'full-target', async () => page(overrides), () => {})).rejects.toThrow();
    }
    await expect(readCompleteMembershipDirectory('member', 'full-target', async sequence => page({ accountVersion: sequence + 1n, next: sequence === 0n ? 1n : null }), () => {})).rejects.toThrow('continuation');
  });
  it('rejects identity changes after replies and conflicting source ownership', async () => {
    await expect(readCompleteMembershipDirectory('member', 'full-target', async () => page(), () => { throw new Error('Signed out'); })).rejects.toThrow('Signed out');
    await expect(readCompleteMembershipDirectory('member', 'full-target', async sequence => page({ assignments: [{ clubId: 'club-a', groupId: sequence === 0n ? 'g1' : 'g2', revision: 1n }], next: sequence === 0n ? 1n : null }), () => {})).rejects.toThrow('Conflicting');
  });
});