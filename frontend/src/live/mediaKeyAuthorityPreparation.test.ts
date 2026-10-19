import { describe, it, expect, vi } from 'vitest';
import { mediaKeyAuthorityPreparation, mediaKeyAuthorityRestoration, type MediaKeyAuthority, type MediaKeyReceipt } from './mediaKeyAuthorityPreparation';
function fixture() {
  const binding = { deploymentId: 'deployment', registryRevision: '7', clubId: 'club', moveId: 'move', originalPiiCanister: 'original', destinationClubCanister: 'target' };
  let current: MediaKeyAuthority = { authority: null, revision: 0n, moveId: '' };
  let durable: MediaKeyReceipt | null = null;
  const d = { verify: vi.fn(async () => {}), read: vi.fn(async () => structuredClone(current)),
    set: vi.fn(async (authority: string | null, moveId: string, expectedRevision: bigint) => {
      if (current.revision !== expectedRevision) throw new Error('CAS');
      current = { authority, moveId, revision: expectedRevision + 1n }; return structuredClone(current);
    }), load: async () => structuredClone(durable), save: vi.fn(async (r: MediaKeyReceipt) => { durable = structuredClone(r); }) };
  return { binding, d, run: () => mediaKeyAuthorityPreparation(binding, d)(), receipt: () => durable,
    change: (s: MediaKeyAuthority) => { current = s; } };
}
describe('original media key authority journal', () => {
  it.each(['unknown', 'restore-intent', 'restored'])('rejects forward preparation with %s journal state', async state => {
    const f = fixture(); await f.run(); const receipt = f.receipt();
    if (!receipt) throw new Error('Missing receipt');
    f.d.load = async () => ({ ...receipt, state } as MediaKeyReceipt);
    await expect(f.run()).rejects.toThrow(); expect(f.d.set).toHaveBeenCalledTimes(1);
  });
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

describe('photo-key abort restoration', () => {
  function recovery(f: ReturnType<typeof fixture>) {
    const verifyAbort = vi.fn(async () => {});
    return { verifyAbort, restore: mediaKeyAuthorityRestoration(f.binding, { ...f.d, verifyAbort }) };
  }
  it('restores null original override by revision CAS and preserves the move tombstone', async () => {
    const f = fixture(); await f.run(); const r = recovery(f); await r.restore();
    expect(f.d.set).toHaveBeenLastCalledWith(null, 'move', 1n);
    expect(f.receipt()?.restored).toEqual({ authority: null, revision: 2n, moveId: 'move' });
    await r.restore(); expect(f.d.set).toHaveBeenCalledTimes(2);
    await expect(f.run()).rejects.toThrow('restoration started');
  });
  it('restores a previous non-default membership authority without resetting revision', async () => {
    const f = fixture(); f.change({ authority: 'previous', revision: 6n, moveId: 'older-move' });
    await f.run(); await recovery(f).restore();
    expect(f.receipt()?.restored).toEqual({ authority: 'previous', revision: 8n, moveId: 'move' });
  });
  it('records no-change abort when the forward CAS never occurred', async () => {
    const f = fixture(); f.d.set.mockRejectedValueOnce(new Error('not sent'));
    await expect(f.run()).rejects.toThrow('not sent'); await recovery(f).restore();
    expect(f.d.set).toHaveBeenCalledTimes(1);
    expect(f.receipt()?.restored).toEqual({ authority: null, revision: 0n, moveId: '' });
  });
  it('persists restore intent before CAS and recovers lost response without duplicate restore', async () => {
    const f = fixture(); await f.run(); const set = f.d.set.getMockImplementation();
    f.d.set.mockImplementationOnce(async (...args) => {
      expect(f.receipt()?.state).toBe('restore-intent');
      if (set) await set(...args); throw new Error('lost response');
    });
    const r = recovery(f); await expect(r.restore()).rejects.toThrow('lost response');
    await r.restore(); expect(f.d.set).toHaveBeenCalledTimes(2); expect(f.receipt()?.state).toBe('restored');
  });
  it('retains fences on restore-intent disk failure without changing authority', async () => {
    const f = fixture(); await f.run(); f.d.save.mockRejectedValueOnce(new Error('disk'));
    await expect(recovery(f).restore()).rejects.toThrow('disk'); expect(f.d.set).toHaveBeenCalledTimes(1);
  });
  it('replays exact restore after acknowledgement disk failure', async () => {
    const f = fixture(); await f.run(); const save = f.d.save.getMockImplementation();
    f.d.save.mockImplementationOnce(async r => { if (save) await save(r); }).mockRejectedValueOnce(new Error('disk'));
    const r = recovery(f); await expect(r.restore()).rejects.toThrow('disk');
    expect(f.receipt()?.state).toBe('restore-intent'); await r.restore(); expect(f.d.set).toHaveBeenCalledTimes(2);
  });
  it.each(['authority', 'moveId', 'revision'] as const)('blocks restoration with foreign %s and keeps original receipt', async key => {
    const f = fixture(); await f.run();
    f.change({ authority: 'target', moveId: 'move', revision: 1n, [key]: key === 'revision' ? 9n : 'foreign' });
    await expect(recovery(f).restore()).rejects.toThrow('Unknown'); expect(f.d.set).toHaveBeenCalledTimes(1);
  });
  it('refuses an abort without current source-placement and held-fence evidence', async () => {
    const f = fixture(); await f.run(); const r = recovery(f); r.verifyAbort.mockRejectedValue(new Error('placement uncertain'));
    await expect(r.restore()).rejects.toThrow('placement uncertain'); expect(f.d.set).toHaveBeenCalledTimes(1);
  });
  it('refuses changed proof immediately before restore CAS', async () => {
    const f = fixture(); await f.run(); const r = recovery(f);
    r.verifyAbort.mockResolvedValueOnce().mockRejectedValueOnce(new Error('fence changed'));
    await expect(r.restore()).rejects.toThrow('fence changed'); expect(f.d.set).toHaveBeenCalledTimes(1);
    expect(f.receipt()?.state).toBe('restore-intent');
  });
  it('requires a saved receipt and rejects malformed original revision', async () => {
    const f = fixture(); await expect(recovery(f).restore()).rejects.toThrow('receipt required');
    await f.run(); const receipt = f.receipt(); if (!receipt) throw new Error('Missing receipt');
    f.d.load = async () => ({ ...receipt, before: { ...receipt.before, revision: -1n } });
    await expect(recovery(f).restore()).rejects.toThrow('Invalid');
  });
  it('blocks replay when a restored authority subsequently changes', async () => {
    const f = fixture(); await f.run(); const r = recovery(f); await r.restore();
    f.change({ authority: 'foreign', revision: 3n, moveId: 'other' });
    await expect(r.restore()).rejects.toThrow('changed after restoration'); expect(f.d.set).toHaveBeenCalledTimes(2);
  });
});