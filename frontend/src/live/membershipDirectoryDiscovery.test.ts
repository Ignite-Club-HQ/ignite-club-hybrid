import { describe, expect, it, vi } from 'vitest';
import { readCompleteMembershipDirectory, type DirectoryPage, type DirectoryContinuation } from './membershipDirectoryDiscovery';
const page = (overrides: Partial<DirectoryPage> = {}): DirectoryPage => ({
  caller: 'member', accountVersion: 1n, generation: 1n, directoryRevision: 1n,
  registryFingerprint: 'full-target', instance: 7n, verifiedCurrent: true, assignments: [], legacyClubs: [], next: null, ...overrides,
});
describe('complete caller-private membership directory', () => {
  it('reads a single-group account once and deduplicates linked aliases across pages', async () => {
    const read = vi.fn(async (continuation: DirectoryContinuation | null) => page({ assignments: [{ clubId: 'club-a', groupId: 'g1', revision: 1n }], next: continuation === null ? { instance: 7n, sequence: 1n } : null }));
    const result = await readCompleteMembershipDirectory('member', 'full-target', read, () => {});
    expect(result.assignments).toEqual([{ clubId: 'club-a', groupId: 'g1', revision: 1n }]);
    expect(read.mock.calls.map(([n]) => n)).toEqual([null, { instance: 7n, sequence: 1n }]);
  });
  it('keeps memberships from both groups without treating a partial page as complete', async () => {
    const result = await readCompleteMembershipDirectory('member', 'full-target', async continuation => page({ assignments: [{ clubId: continuation === null ? 'club-a' : 'club-b', groupId: continuation === null ? 'g1' : 'g2', revision: 1n }], next: continuation === null ? { instance: 7n, sequence: 1n } : null }), () => {});
    expect(result.assignments.map(row => row.groupId)).toEqual(['g1', 'g2']);
    await expect(readCompleteMembershipDirectory('member', 'full-target', async continuation => page({ verifiedCurrent: continuation === null, next: continuation === null ? { instance: 7n, sequence: 1n } : null }), () => {})).rejects.toThrow('incomplete');
  });
  it('rejects caller, target, version and future-page substitution', async () => {
    for (const overrides of [{ caller: 'other' }, { registryFingerprint: 'foreign' }, { accountVersion: 0n }, { next: { instance: 7n, sequence: 2n } }, { instance: 0n }, { next: { instance: 8n, sequence: 1n } }]) {
      await expect(readCompleteMembershipDirectory('member', 'full-target', async () => page(overrides), () => {})).rejects.toThrow();
    }
    await expect(readCompleteMembershipDirectory('member', 'full-target', async continuation => page({ accountVersion: (continuation?.sequence ?? 0n) + 1n, next: continuation === null ? { instance: 7n, sequence: 1n } : null }), () => {})).rejects.toThrow('continuation');
    await expect(readCompleteMembershipDirectory('member', 'full-target', async continuation => page({ instance: continuation === null ? 7n : 8n, next: continuation === null ? { instance: 7n, sequence: 1n } : null }), () => {})).rejects.toThrow('incomplete');
  });
  it('rejects identity changes after replies and conflicting source ownership', async () => {
    await expect(readCompleteMembershipDirectory('member', 'full-target', async () => page(), () => { throw new Error('Signed out'); })).rejects.toThrow('Signed out');
    await expect(readCompleteMembershipDirectory('member', 'full-target', async continuation => page({ assignments: [{ clubId: 'club-a', groupId: continuation === null ? 'g1' : 'g2', revision: 1n }], next: continuation === null ? { instance: 7n, sequence: 1n } : null }), () => {})).rejects.toThrow('Conflicting');
  });
  it('refuses a release or inventory replacement between pages',async()=>{
    await expect(readCompleteMembershipDirectory('member','full-target',async token=>page({releaseBinding:token?'new':'old',next:token?null:{instance:7n,sequence:1n}}),()=>{})).rejects.toThrow('continuation');
  });
});