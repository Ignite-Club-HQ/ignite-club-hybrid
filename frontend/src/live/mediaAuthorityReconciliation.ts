/** Operator evidence only; authenticated adapters supply inputs. Never proves key access. */
import type { StoredClubInventory } from './mediaStoreInventory';
import type { MediaTransferInventory } from './mediaTransferSafety';
export const MEDIA_REFERENCE_DOMAINS = ['gallery', 'chat', 'vault', 'articles'] as const;
type Domain = typeof MEDIA_REFERENCE_DOMAINS[number];
type Binding = { deploymentId: string; registryRevision: string; clubId: string };
type Location = { storeId: string; path: string };
export type MediaMetadataEvidence = Binding & {
  complete: boolean;
  domains: { domain: Domain; revision: string; fenced: boolean }[];
  references: (Location & { domain: Domain; resourceId: string; contentHash: string; contentLength: bigint })[];
  provenance: (Location & { contentHash: string; piiAuthorityId: string; identity: string; field: 'blob'; encryption: 'club' | 'own' })[];
};
export type MediaAuthorityEvidence = Binding & {
  complete: boolean; destinationPiiAuthorityId: string;
  stores: { storeId: string; piiAuthorityId: string; host: string }[];
};
const key = (v: Location) => JSON.stringify([v.storeId, v.path]);
function httpsOrigin(host: string) {
  try { const u = new URL(host); return u.protocol === 'https:' && u.origin === host && !u.username && !u.password; } catch { return false; }
}
export function reconcileMediaAuthority(storage: StoredClubInventory, metadata: MediaMetadataEvidence, authorities: MediaAuthorityEvidence) {
  for (const evidence of [metadata, authorities]) {
    if (!evidence.complete || !storage.deploymentId || !storage.registryRevision || !storage.clubId ||
        evidence.deploymentId !== storage.deploymentId || evidence.registryRevision !== storage.registryRevision || evidence.clubId !== storage.clubId)
      throw new Error('Complete matching authenticated media evidence required');
  }
  if (metadata.domains.length !== 4 || new Set(metadata.domains.map(d => d.domain)).size !== 4 ||
      MEDIA_REFERENCE_DOMAINS.some(domain => !metadata.domains.some(d => d.domain === domain && d.fenced && d.revision)))
    throw new Error('Fenced gallery, chat, vault and article inventories required');
  const stores = new Map(storage.stores.map(s => [s.canisterId, s]));
  const authorityMap = new Map(authorities.stores.map(s => [s.storeId, s]));
  if (!stores.size || stores.size !== storage.stores.length || !authorities.destinationPiiAuthorityId ||
      authorityMap.size !== authorities.stores.length || authorityMap.size !== stores.size ||
      authorities.stores.some(a => !stores.has(a.storeId) || !a.piiAuthorityId || !httpsOrigin(a.host)))
    throw new Error('Missing or conflicting original media authority');
  const blobs = new Map<string, Location & { contentHash: string; contentLength: bigint }>();
  let pending = 0;
  for (const store of storage.stores) {
    if (!store.canisterId || store.revision < 0n || store.fenceRevision < 0n) throw new Error('Invalid store revision');
    const unfinished = new Set<string>();
    for (const entry of store.entries) {
      if (!entry.path.startsWith(`clubs/${storage.clubId}/`) || entry.content_length < 0n) throw new Error('Invalid club object');
      if ('blob' in entry.kind) {
        const location = { storeId: store.canisterId, path: entry.path };
        if (blobs.has(key(location)) || entry.unsettled || !/^[a-f0-9]{64}$/.test(entry.content_hash)) throw new Error('Invalid duplicate ciphertext');
        blobs.set(key(location), { ...location, contentHash: entry.content_hash, contentLength: entry.content_length });
      } else {
        if (!entry.unsettled || !entry.upload_id) throw new Error('Invalid unsettled evidence');
        unfinished.add(entry.upload_id);
      }
    }
    pending += unfinished.size;
  }
  if (pending !== storage.pendingUploads || blobs.size !== storage.encryptedObjects) throw new Error('Inventory counts mismatch');
  const refs = new Map<string, string[]>(); const seenRefs = new Set<string>();
  for (const ref of metadata.references) {
    const blob = blobs.get(key(ref)); const id = `${ref.domain}:${ref.resourceId}`;
    const unique = JSON.stringify([id, key(ref)]);
    if (!MEDIA_REFERENCE_DOMAINS.includes(ref.domain) || !ref.resourceId || seenRefs.has(unique) || !blob ||
        blob.contentHash !== ref.contentHash || blob.contentLength !== ref.contentLength) throw new Error('Missing or mismatched media reference');
    seenRefs.add(unique); refs.set(key(ref), [...(refs.get(key(ref)) ?? []), id]);
  }
  const provenance = new Map<string, MediaMetadataEvidence['provenance'][number]>();
  for (const p of metadata.provenance) {
    const blob = blobs.get(key(p)); const authority = authorityMap.get(p.storeId);
    if (!blob || provenance.has(key(p)) || blob.contentHash !== p.contentHash || !authority || p.piiAuthorityId !== authority.piiAuthorityId ||
        !['club', 'own'].includes(p.encryption) || p.field !== 'blob' ||
        p.identity !== (p.encryption === 'club' ? `clubmedia:${storage.clubId}` : p.path)) throw new Error('Invalid or conflicting encryption provenance');
    provenance.set(key(p), p);
  }
  const objects = [...blobs.entries()].map(([k, blob]) => {
    const authority = authorityMap.get(blob.storeId);
    if (!authority) throw new Error('Missing authority');
    return { ...blob, referenceIds: refs.get(k) ?? [], orphan: !refs.has(k), provenance: provenance.get(k) ?? null,
      originalAuthorityHost: authority.host, destinationAuthorityDiffers: authority.piiAuthorityId !== authorities.destinationPiiAuthorityId };
  });
  const unresolvedPaths = objects.filter(o => !o.provenance).map(o => ({ storeId: o.storeId, path: o.path }));
  return { deploymentId: storage.deploymentId, registryRevision: storage.registryRevision, clubId: storage.clubId,
    objects, unresolvedPaths, orphanObjects: objects.filter(o => o.orphan).length, encryptedObjects: blobs.size,
    pendingUploads: pending, inventoryResolved: unresolvedPaths.length === 0, encryptedMoveAuthorized: false as const };
}
export function mediaTransferInventoryFromReport(report: ReturnType<typeof reconcileMediaAuthority>, fromGroup: string, toGroup: string, sharedQuotaReady: boolean): MediaTransferInventory {
  return { clubId: report.clubId, fromGroup, toGroup, complete: report.inventoryResolved, encryptedObjects: report.encryptedObjects,
    pendingUploads: report.pendingUploads, sharedQuotaReady };
}
