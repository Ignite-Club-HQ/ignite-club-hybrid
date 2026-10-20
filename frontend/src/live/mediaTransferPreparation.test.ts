import { describe, expect, it, vi } from 'vitest';
import { mediaTransferPreparation, reconciledMediaTransferInventory, type MediaFenceActor, type MediaFenceReceipt } from './mediaTransferPreparation';
import type { StoreInventoryRegistry } from './mediaStoreInventory';
import { liveTransferAdapter, LIVE_DOMAINS, type GroupActors, type LiveAdapterDeps } from './groupTransferLiveAdapter';
import { runTransfer } from './groupTransferRunner';
import { planTransfer } from './groupTransfer';

function fixture() {
  let durable: MediaFenceReceipt | null = null;
  const state = [{ revision: 0n, fence: undefined as bigint | undefined }, { revision: 0n, fence: undefined as bigint | undefined }];
  const actors: MediaFenceActor[] = state.map(s => ({
    set_club_media_transfer_fence: vi.fn(async (_c, on, expected) => {
      if (expected[0] !== s.fence) return { Err: 'CAS mismatch' };
      s.revision++; s.fence = on ? s.revision : undefined; return { Ok: null };
    }),
    club_media_inventory_page: vi.fn(async (_c, cursor, expected) => {
      if (expected[0] !== undefined && expected[0] !== s.revision) return { Err: 'revision changed' };
      const phases = ['legacy', 'indexed', 'pending', 'journal', 'done']; const index = phases.indexOf(Object.keys(cursor.phase)[0]);
      return { Ok: { revision: s.revision, fenced: s.fence !== undefined, fence_revision: s.fence === undefined ? [] : [s.fence],
        quota_shared: true, quota_authority: [{ toText: () => 'q' }], entries: [], scanned: 0n,
        next: index === 4 ? [] : [{ phase: { [phases[index + 1]]: null }, offset: 0n, after: '' }] } } as Awaited<ReturnType<MediaFenceActor['club_media_inventory_page']>>;
    }),
  }));
  const registry: StoreInventoryRegistry = { deploymentId: 'd', revision: 'r', complete: true,
    stores: actors.map((actor, i) => ({ canisterId: `s${i}`, quotaAuthority: 'q', actor })) };
  const d = { readRegistry: vi.fn(async () => registry), actor: (id: string) => actors[Number(id.slice(1))],
    load: async () => durable, save: vi.fn(async (r: MediaFenceReceipt) => { durable = structuredClone(r); }) };
  const binding = { moveId: 'm', deploymentId: 'd', clubId: 'c', fromGroup: 'a', toGroup: 'b' };
  const create = () => mediaTransferPreparation(binding, d);
  return { d, state, actors, registry, binding, create, receipt: () => durable };
}
describe('durable media move preparation', () => {
  it('journals the complete inventory before fences and resumes without acquiring duplicate locks', async () => {
    const f = fixture(); const result = await f.create().prepare();
    expect(result.stores).toHaveLength(2); expect(f.d.save.mock.calls[0][0].stores.map(s => s.state)).toEqual(['intent', 'intent']);
    await f.create().prepare();
    for (const a of f.actors) expect(a.set_club_media_transfer_fence).toHaveBeenCalledTimes(1);
    expect(f.receipt()?.stores.map(s => s.state)).toEqual(['held', 'held']);
  });
  it('does not mutate any store when durable intent cannot be saved', async () => {
    const f = fixture(); f.d.save.mockRejectedValue(new Error('disk failed'));
    await expect(f.create().prepare()).rejects.toThrow('disk failed');
    for (const a of f.actors) expect(a.set_club_media_transfer_fence).not.toHaveBeenCalled();
  });
  it('retains partial fences and safely resumes an unattempted second store', async () => {
    const f = fixture(); vi.mocked(f.actors[1].set_club_media_transfer_fence).mockRejectedValueOnce(new Error('offline'));
    await expect(f.create().prepare()).rejects.toThrow('offline'); expect(f.state[0].fence).toBe(1n);
    await f.create().prepare(); expect(f.state[1].fence).toBe(1n);
    expect(f.actors[0].set_club_media_transfer_fence).toHaveBeenCalledTimes(1);
  });
  it('never adopts or releases a fence after a lost acquisition acknowledgement', async () => {
    const f = fixture(); const original = f.actors[1].set_club_media_transfer_fence;
    f.actors[1].set_club_media_transfer_fence = async (...args) => { await original(...args); throw new Error('ack lost'); };
    await expect(f.create().prepare()).rejects.toThrow('ack lost');
    await expect(f.create().prepare()).rejects.toThrow('Unacknowledged');
    await expect(f.create().release()).rejects.toThrow('Unverified');
    expect(f.state.map(s => s.fence)).toEqual([1n, 1n]);
  });
  it.each(['incomplete', 'foreign', 'duplicate', 'changed', 'quota'])('blocks %s registry evidence', async fault => {
    const f = fixture(); if (fault === 'changed' || fault === 'quota') await f.create().prepare();
    if (fault === 'incomplete') f.registry.complete = false;
    if (fault === 'foreign') f.registry.deploymentId = 'other';
    if (fault === 'duplicate') f.registry.stores.push(f.registry.stores[0]);
    if (fault === 'changed') f.registry.revision = 'r2';
    if (fault === 'quota') f.registry.stores[0].quotaAuthority = 'q2';
    await expect(f.create().prepare()).rejects.toThrow();
  });
  it('validates every fence before releasing the first, preserving locks on foreign revision', async () => {
    const f = fixture(); await f.create().prepare(); f.state[1].fence = 9n;
    await expect(f.create().release()).rejects.toThrow('Unverified'); expect(f.state[0].fence).toBe(1n);
  });
  it('replays a lost release acknowledgement without a second unlock mutation', async () => {
    const f = fixture(); await f.create().prepare(); const original = f.actors[0].set_club_media_transfer_fence;
    f.actors[0].set_club_media_transfer_fence = async (...args) => { await original(...args); throw new Error('release ack lost'); };
    await expect(f.create().release()).rejects.toThrow('release ack lost');
    f.actors[0].set_club_media_transfer_fence = original; await f.create().release();
    expect(f.state.map(s => s.fence)).toEqual([undefined, undefined]);
    expect(original).toHaveBeenCalledTimes(2); expect(f.receipt()?.stores.map(s => s.state)).toEqual(['released', 'released']);
    await expect(f.create().prepare()).rejects.toThrow('release already');
  });
  it('refuses a receipt for another move without touching its locks', async () => {
    const f = fixture(); await f.create().prepare();
    await expect(mediaTransferPreparation({ ...f.binding, moveId: 'other' }, f.d).prepare()).rejects.toThrow('another move');
    expect(f.state.map(s => s.fence)).toEqual([1n, 1n]);
  });
  const evidence = (storage: { deploymentId: string; registryRevision: string; clubId: string }) => ({
    metadata: { ...storage, complete: true, domains: ['gallery', 'chat', 'vault', 'articles'].map(domain => ({ domain: domain as 'gallery' | 'chat' | 'vault' | 'articles', revision: '1', fenced: true })), references: [], provenance: [] },
    authorities: { ...storage, complete: true, destinationPiiAuthorityId: 'dest', stores: ['s0','s1'].map(storeId => ({ storeId, piiAuthorityId: 'original', host: 'https://icp-api.io' })) }, sharedQuotaReady: true,
  });
  it('connects complete media-free evidence to the real resumable move adapter, then releases owned locks', async () => {
    const f = fixture(); const preparation = f.create();
    const inventory = reconciledMediaTransferInventory(f.binding, preparation, { read: async storage => evidence(storage) });
    const ok = async () => ({ Ok: null });
    const snapshot = { set_transfer_fence: vi.fn(ok), export_club_snapshot: async () => ({ Ok: new Uint8Array([1]) }), import_club_snapshot: ok, purge_club_snapshot: vi.fn(async () => ({ Ok: 0n })) };
    const groups = Object.fromEntries(['a','b'].map(g => [g, Object.fromEntries(LIVE_DOMAINS.map(domain => [domain, { ...snapshot }]))])) as unknown as Record<string, GroupActors>;
    for (const group of Object.values(groups)) {
      Object.assign(group.club_domain, { freeze_club: ok, unfreeze_club: ok });
      Object.assign(group.insights_domain, { claim_legacy_sponsor_metrics: ok });
      Object.assign(group.messaging_domain, { export_club_snapshot_page: async () => ({ Ok: new Uint8Array([1]) }), import_club_snapshot_page: ok });
    }
    const swap = vi.fn(async () => {});
    const deps = { actors: g => groups[g], clubSponsorIds: async () => [], sameDeployment: async () => true,
      readRegistryRevision: async () => 7n, swapAssignment: swap, save: async () => {}, fenceRevision: 7n,
      targetFor: async () => 'b', mediaInventory: inventory, mediaPreparation: preparation } as LiveAdapterDeps;
    const result = await runTransfer(planTransfer('c', 'a', 'b', 7n), liveTransferAdapter(deps));
    expect(result.phase).toBe('released'); expect(swap).toHaveBeenCalledWith('c','b',7n);
    expect(f.state.map(s => s.fence)).toEqual([undefined,undefined]);
  });
  it('rejects a store revision change during metadata reconciliation and keeps fences', async () => {
    const f = fixture(); const inventory = reconciledMediaTransferInventory(f.binding, f.create(), { read: async storage => { f.state[0].revision++; return evidence(storage); } });
    await expect(inventory('a','b','c')).rejects.toThrow('changed during reconciliation');
    expect(f.state.map(s => s.fence)).toEqual([1n,1n]);
  });
  it('blocks a callback for the wrong club before locking any store', async () => {
    const f = fixture(); const inventory = reconciledMediaTransferInventory(f.binding, f.create(), { read: async storage => evidence(storage) });
    await expect(inventory('a','b','other')).rejects.toThrow('Wrong media'); expect(f.d.save).not.toHaveBeenCalled();
  });
});