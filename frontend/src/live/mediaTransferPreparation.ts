/** Operator-only durable blob-fence journal. The registry reader must prove
 * completeness/authenticity externally; browser settings are not evidence.
 * Ambiguous acquisition, persistence and scan failures retain every lock.
 * Explicit release is allowed only after the caller proves safe completion
 * or abort. This module never grants permission to move encrypted objects. */
import { readFencedClubStoreInventory, type MediaInventoryActor, type StoreInventoryRegistry } from './mediaStoreInventory';
import { reconcileMediaAuthority, mediaTransferInventoryFromReport, type MediaMetadataEvidence, type MediaAuthorityEvidence } from './mediaAuthorityReconciliation';

export type MediaFenceActor = MediaInventoryActor & {
  set_club_media_transfer_fence(club: string, on: boolean, expected: [] | [bigint]): Promise<{ Ok: null } | { Err: string }>;
};
export type MediaFenceReceipt = {
  moveId: string; deploymentId: string; registryRevision: string; clubId: string;
  fromGroup: string; toGroup: string;
  stores: { canisterId: string; quotaAuthority: string; state: 'intent' | 'held' | 'release-intent' | 'released'; revision?: bigint }[];
};
export type MediaPreparationDeps = {
  readRegistry(): Promise<StoreInventoryRegistry>;
  actor(canisterId: string): MediaFenceActor;
  load(): Promise<MediaFenceReceipt | null>;
  /** Must persist durably under an exclusive operator lock before returning. */
  save(receipt: MediaFenceReceipt): Promise<void>;
};
const done = { phase: { done: null }, offset: 0n, after: '' } as const;
const unwrap = <T>(r: { Ok: T } | { Err: string }) => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
function checkRegistry(r: StoreInventoryRegistry, deploymentId: string) {
  if (!r.complete || r.deploymentId !== deploymentId || !r.revision || !r.stores.length ||
      new Set(r.stores.map(s => s.canisterId)).size !== r.stores.length || r.stores.some(s => !s.canisterId || !s.quotaAuthority))
    throw new Error('Complete authenticated media registry required');
}
function checkBinding(receipt: MediaFenceReceipt, registry: StoreInventoryRegistry) {
  checkRegistry(registry, receipt.deploymentId);
  if (registry.revision !== receipt.registryRevision || registry.stores.length !== receipt.stores.length ||
      receipt.stores.some(s => !registry.stores.some(r => r.canisterId === s.canisterId && r.quotaAuthority === s.quotaAuthority)))
    throw new Error('Media registry changed; retain fences for operator recovery');
}
export function mediaTransferPreparation(binding: Pick<MediaFenceReceipt, 'moveId' | 'deploymentId' | 'clubId' | 'fromGroup' | 'toGroup'>, d: MediaPreparationDeps) {
  if (!binding.moveId || !binding.deploymentId || !binding.clubId || binding.clubId.includes('/') || binding.clubId.length > 128 ||
      !binding.fromGroup || !binding.toGroup || binding.fromGroup === binding.toGroup) throw new Error('Invalid media move binding');
  const load = async () => {
    const receipt = await d.load();
    if (receipt && Object.entries(binding).some(([k, v]) => receipt[k as keyof typeof binding] !== v))
      throw new Error('Media receipt belongs to another move');
    return receipt;
  };
  const persist = async (r: MediaFenceReceipt) => d.save(structuredClone(r));
  const inspect = async (id: string) => unwrap(await d.actor(id).club_media_inventory_page(binding.clubId, done, []));
  return {
    async prepare() {
      const registry = await d.readRegistry(); checkRegistry(registry, binding.deploymentId);
      let receipt = await load();
      if (!receipt) {
        receipt = { ...binding, registryRevision: registry.revision,
          stores: registry.stores.map(s => ({ canisterId: s.canisterId, quotaAuthority: s.quotaAuthority, state: 'intent' })) };
        await persist(receipt); // entire inventory intent precedes any mutation
      }
      checkBinding(receipt, registry);
      for (const store of receipt.stores) {
        if (store.state === 'release-intent' || store.state === 'released') throw new Error('Media release already started; recovery required');
        const page = await inspect(store.canisterId);
        if (store.state === 'intent') {
          // An existing fence may belong to a different operator or an
          // unacknowledged prior call. Never adopt it by guessing ownership.
          if (page.fenced || page.fence_revision.length) throw new Error('Unacknowledged media fence; operator recovery required');
          unwrap(await d.actor(store.canisterId).set_club_media_transfer_fence(binding.clubId, true, []));
          const held = await inspect(store.canisterId);
          if (!held.fenced || held.fence_revision.length !== 1) throw new Error('Media fence acquisition not confirmed');
          store.revision = held.fence_revision[0]; store.state = 'held'; await persist(receipt);
        } else if (!page.fenced || page.fence_revision[0] !== store.revision) throw new Error('Media fence ownership changed');
      }
      const storage = await readFencedClubStoreInventory(binding.clubId, binding.deploymentId, d.readRegistry);
      checkBinding(receipt, await d.readRegistry());
      if (storage.stores.some(s => !receipt.stores.some(r => r.canisterId === s.canisterId && r.revision === s.fenceRevision)))
        throw new Error('Media scan fence differs from durable receipt');
      return storage;
    },
    async release() {
      const receipt = await load(); if (!receipt) throw new Error('Media receipt required for release');
      checkBinding(receipt, await d.readRegistry());
      // Validate all locks before unlocking even the first store.
      for (const store of receipt.stores) {
        const page = await inspect(store.canisterId);
        if (store.state === 'intent' || store.revision === undefined ||
            (page.fenced ? page.fence_revision[0] !== store.revision || store.state === 'released' : store.state === 'held'))
          throw new Error('Unverified media fence; retain locks');
      }
      for (const store of receipt.stores) {
        if (store.state === 'released') continue;
        store.state = 'release-intent'; await persist(receipt);
        const page = await inspect(store.canisterId);
        if (page.fenced) unwrap(await d.actor(store.canisterId).set_club_media_transfer_fence(binding.clubId, false, [store.revision as bigint]));
        store.state = 'released'; await persist(receipt);
      }
    },
  };
}

/** Connects the fenced storage reader to metadata/provenance evidence supplied
 * by authenticated, domain-fenced readers. Re-reads on every runner check. */
export function reconciledMediaTransferInventory(binding: { fromGroup: string; toGroup: string; clubId: string }, preparation: ReturnType<typeof mediaTransferPreparation>, evidence: {
  read(storage: Awaited<ReturnType<typeof preparation.prepare>>): Promise<{ metadata: MediaMetadataEvidence; authorities: MediaAuthorityEvidence; sharedQuotaReady: boolean }>;
}) {
  return async (fromGroup: string, toGroup: string, clubId: string) => {
    if (fromGroup !== binding.fromGroup || toGroup !== binding.toGroup || clubId !== binding.clubId) throw new Error('Wrong media transfer binding');
    const storage = await preparation.prepare();
    const { metadata, authorities, sharedQuotaReady } = await evidence.read(storage);
    const fresh = await preparation.prepare();
    if (fresh.registryRevision !== storage.registryRevision || fresh.stores.some(s => !storage.stores.some(r =>
      r.canisterId === s.canisterId && r.revision === s.revision && r.fenceRevision === s.fenceRevision))) throw new Error('Media changed during reconciliation');
    return mediaTransferInventoryFromReport(reconcileMediaAuthority(fresh, metadata, authorities), fromGroup, toGroup, sharedQuotaReady);
  };
}