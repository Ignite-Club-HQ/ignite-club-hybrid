import { describe, it, expect, vi } from 'vitest';
import { mediaKeyAuthorityPreparation, type MediaKeyAuthority, type MediaKeyReceipt } from './mediaKeyAuthorityPreparation';
function fixture() {
  const binding = { deploymentId: 'deployment', registryRevision: '7', clubId: 'club', moveId: 'move', originalPiiCanister: 'original', destinationClubCanister: 'target' };
  let current: MediaKeyAuthority = { authority: null, revision: 0n, moveId: '' };
  let durable: MediaKeyReceipt | null = null;
  const d = { verify: vi.fn(async () => {}), read: vi.fn(async () => structuredClone(current)),
    set: vi.fn(async (authority: string, moveId: string, expectedRevision: bigint) => {
      if (current.revision !== expectedRevision) throw new Error('CAS');
      current = { authority, moveId, revision: expectedRevision + 1n }; return structuredClone(current);
    }), load: async () => structuredClone(durable), save: vi.fn(async (r: MediaKeyReceipt) => { durable = structuredClone(r); }) };
  return { binding, d, run: () => mediaKeyAuthorityPreparation(binding, d)(), receipt: () => durable,
    change: (s: MediaKeyAuthority) => { current = s; } };
}
describe('original media key authority journal', () => {
  it('persists exact CAS intent before mutation and replays acknowledged state without another write', async () => {
    const f = fixture(); await f.run();
    expect(f.d.save.mock.invocationCallOrder[0]).toBeLessThan(f.d.set.mock.invocationCallOrder[0]);
    expect(f.receipt()?.after).toEqual({ authority: 'target', revision: 1n, moveId: 'move' });
    await f.run(); expect(f.d.set).toHaveBeenCalledTimes(1);
  });
  it('never writes if intent persistence fails', async () => {
    const f = fixture(); f.d.save.mockRejectedValueOnce(new Error('disk'));
    await expect(f.run()).rejects.toThrow('disk'); expect(f.d.set).not.toHaveBeenCalled();
  });
  it('recovers a lost response only by reading the exact persisted move/revision/authority', async () => {
    const f = fixture(); const set = f.d.set.getMockImplementation();
    f.d.set.mockImplementationOnce(async (...args) => { if (set) await set(...args); throw new Error('lost'); });
    await expect(f.run()).rejects.toThrow('lost'); expect(f.receipt()?.state).toBe('intent');
    await f.run(); expect(f.d.set).toHaveBeenCalledTimes(1); expect(f.receipt()?.state).toBe('acknowledged');
  });
  it.each(['authority', 'moveId', 'revision'] as const)('rejects a changed %s rather than adopting a foreign acknowledgement', async key => {
    const f = fixture(); await f.run();
    f.change({ authority: 'target', moveId: 'move', revision: 1n, [key]: key === 'revision' ? 2n : 'foreign' });
    await expect(f.run()).rejects.toThrow('changed'); expect(f.d.set).toHaveBeenCalledTimes(1);
  });
  it('retains acknowledged remote state if final persistence fails and recovers without replaying CAS', async () => {
    const f = fixture(); const save = f.d.save.getMockImplementation();
    f.d.save.mockImplementationOnce(async r => { if (save) await save(r); }).mockRejectedValueOnce(new Error('disk'));
    await expect(f.run()).rejects.toThrow('disk');
    await f.run(); expect(f.d.set).toHaveBeenCalledTimes(1);
  });
  it('refuses missing authenticated proof before writing', async () => {
    const f = fixture(); f.d.verify.mockRejectedValue(new Error('unverified deployment'));
    await expect(f.run()).rejects.toThrow('unverified'); expect(f.d.set).not.toHaveBeenCalled();
  });
  it('rechecks proof before CAS and retains intent on fence drift', async () => {
    const f = fixture(); f.d.verify.mockResolvedValueOnce().mockRejectedValueOnce(new Error('fence changed'));
    await expect(f.run()).rejects.toThrow('fence changed'); expect(f.d.set).not.toHaveBeenCalled(); expect(f.receipt()?.state).toBe('intent');
  });
  it('refuses a saved receipt belonging to a different deployment', async () => {
    const f = fixture(); await f.run();
    await expect(mediaKeyAuthorityPreparation({ ...f.binding, deploymentId: 'other' }, f.d)()).rejects.toThrow('another move');
  });
});