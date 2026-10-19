/** Governor-authenticated consensus storage registry. Approved store-to-key
 * provenance is separate: placement alone NEVER proves the encryption key. */
import type { MediaFenceActor } from './mediaTransferPreparation';
import type { StoreInventoryRegistry } from './mediaStoreInventory';
type PrincipalLike = { toText(): string };
type Result<T> = { Ok: T } | { Err: string };
export type MediaRegistryPlacement = { revision: string; deploymentId: string; host: string; complete: boolean;
  stores: { canisterId: string; quotaAuthority: string; subnetId: string }[]; approvedSubnets: string[] };
const unwrap = <T>(r: Result<T>) => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
export function createMediaOperatorRegistry(binding: { deploymentId: string; host: string }, d: {
  /** Authenticated full shard-router deployment/placement snapshot. */
  readPlacement(): Promise<MediaRegistryPlacement>;
  quotaActor(id: string): { read_media_quota_store_registry(): Promise<Result<{ active: boolean; stores: PrincipalLike[] }>> };
  storeActor(id: string): MediaFenceActor;
}) {
  const check = (p: MediaRegistryPlacement) => {
    let url: URL; try { url = new URL(p.host); } catch { throw new Error('Invalid media deployment host'); }
    if (!binding.deploymentId || p.deploymentId !== binding.deploymentId || p.host !== binding.host ||
        url.protocol !== 'https:' || url.origin !== p.host || url.username || url.password ||
        !p.complete || !p.revision || !p.stores.length || p.stores.length > 1024 ||
        new Set(p.stores.map(s => s.canisterId)).size !== p.stores.length ||
        p.stores.some(s => !s.canisterId || !s.quotaAuthority || !p.approvedSubnets.includes(s.subnetId)))
      throw new Error('Complete approved media placement required');
  };
  const signature = (p: MediaRegistryPlacement) => JSON.stringify({ ...p, stores: [...p.stores].sort((a, b) => a.canisterId.localeCompare(b.canisterId)), approvedSubnets: [...p.approvedSubnets].sort() });
  return async (): Promise<StoreInventoryRegistry> => {
    const p = await d.readPlacement(); check(p);
    const authorities = [...new Set(p.stores.map(s => s.quotaAuthority))];
    const readAll = async () => Promise.all(authorities.map(async authority => {
      const r = unwrap(await d.quotaActor(authority).read_media_quota_store_registry());
      const actual = r.stores.map(s => s.toText()).sort();
      const expected = p.stores.filter(s => s.quotaAuthority === authority).map(s => s.canisterId).sort();
      if (!r.active || actual.length > 64 || new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error('Registered media stores differ from deployment inventory');
      return { authority, actual };
    }));
    const before = await readAll(); const fresh = await d.readPlacement(); check(fresh);
    if (signature(p) !== signature(fresh) || JSON.stringify(before) !== JSON.stringify(await readAll()))
      throw new Error('Media registry changed during consensus reads');
    return { deploymentId: p.deploymentId, revision: p.revision, complete: true,
      stores: p.stores.map(s => ({ canisterId: s.canisterId, quotaAuthority: s.quotaAuthority, actor: d.storeActor(s.canisterId) })) };
  };
}