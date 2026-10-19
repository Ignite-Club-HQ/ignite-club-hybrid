import { describe, it, expect } from 'vitest';
import { reconcileMediaAuthority, mediaTransferInventoryFromReport, type MediaMetadataEvidence, type MediaAuthorityEvidence } from './mediaAuthorityReconciliation';
import type { StoredClubInventory } from './mediaStoreInventory';
import { assertMediaTransferSafe } from './mediaTransferSafety';
function fixture() {
  const bind = { deploymentId: 'd', registryRevision: 'r', clubId: 'c' }; const hash = 'a'.repeat(64);
  const loc = { storeId: 'store', path: 'clubs/c/photos/image' };
  const storage: StoredClubInventory = { ...bind, encryptedObjects: 1, pendingUploads: 0, stores: [{ canisterId: 'store', revision: 1n, fenceRevision: 2n,
    entries: [{ kind: { blob: null }, path: loc.path, content_hash: hash, content_length: 12n, unsettled: false, upload_id: '' }] }] };
  const metadata: MediaMetadataEvidence = { ...bind, complete: true, domains: ['gallery', 'chat', 'vault', 'articles'].map(domain => ({ domain: domain as 'gallery' | 'chat' | 'vault' | 'articles', revision: '1', fenced: true })),
    references: [{ ...loc, domain: 'gallery', resourceId: 'photo', contentHash: hash, contentLength: 12n }],
    provenance: [{ ...loc, contentHash: hash, piiAuthorityId: 'source', identity: 'clubmedia:c', field: 'blob', encryption: 'club' }] };
  const authorities: MediaAuthorityEvidence = { ...bind, complete: true, destinationPiiAuthorityId: 'destination', stores: [{ storeId: 'store', piiAuthorityId: 'source', host: 'https://icp-api.io' }] };
  return { storage, metadata, authorities };
}
describe('media provenance reconciliation', () => {
  it('matches source authority but does not authorize encrypted moves', () => {
    const f = fixture(); const r = reconcileMediaAuthority(f.storage, f.metadata, f.authorities);
    expect(r.inventoryResolved).toBe(true); expect(r.objects[0].destinationAuthorityDiffers).toBe(true);
    expect(r.objects[0].referenceIds).toEqual(['gallery:photo']); expect(r.encryptedMoveAuthorized).toBe(false);
    expect(() => assertMediaTransferSafe(mediaTransferInventoryFromReport(r, 'a', 'b', true), 'c', 'a', 'b')).toThrow('Encrypted media');
  });
  it('retains orphan bytes with unresolved provenance', () => {
    const f = fixture(); f.metadata.references = []; f.metadata.provenance = [];
    const r = reconcileMediaAuthority(f.storage, f.metadata, f.authorities);
    expect(r.orphanObjects).toBe(1); expect(r.encryptedObjects).toBe(1); expect(r.unresolvedPaths).toHaveLength(1);
    expect(mediaTransferInventoryFromReport(r, 'a', 'b', true).complete).toBe(false);
  });
  it('validates own-locked per-file identity separately', () => {
    const f = fixture(); f.metadata.provenance[0].encryption = 'own'; f.metadata.provenance[0].identity = f.metadata.provenance[0].path;
    expect(reconcileMediaAuthority(f.storage, f.metadata, f.authorities).inventoryResolved).toBe(true);
  });
  it('deduplicates pending and journal evidence without authorizing unsettled moves', () => {
    const f = fixture(); const entry = f.storage.stores[0].entries[0];
    f.storage.stores[0].entries.push({ ...entry, kind: { pending: null }, upload_id: 'u', unsettled: true }, { ...entry, kind: { journal: null }, upload_id: 'u', unsettled: true });
    f.storage.pendingUploads = 1; const r = reconcileMediaAuthority(f.storage, f.metadata, f.authorities);
    expect(r.pendingUploads).toBe(1);
    expect(() => assertMediaTransferSafe(mediaTransferInventoryFromReport(r, 'a', 'b', true), 'c', 'a', 'b')).toThrow('Unsettled');
  });
  it.each(['revision','club','deployment','complete','domain','fence','authority','host','pointer','hash','bytes','identity','duplicate','count'])('rejects %s evidence', fault => {
    const f = fixture();
    if (fault === 'revision') f.metadata.registryRevision = 'other';
    if (fault === 'club') f.authorities.clubId = 'other';
    if (fault === 'deployment') f.authorities.deploymentId = 'other';
    if (fault === 'complete') f.metadata.complete = false;
    if (fault === 'domain') f.metadata.domains.pop();
    if (fault === 'fence') f.metadata.domains[0].fenced = false;
    if (fault === 'authority') f.metadata.provenance[0].piiAuthorityId = 'destination';
    if (fault === 'host') f.authorities.stores[0].host = 'http://icp-api.io';
    if (fault === 'pointer') f.metadata.references[0].path = 'clubs/c/missing';
    if (fault === 'hash') f.metadata.references[0].contentHash = 'b'.repeat(64);
    if (fault === 'bytes') f.metadata.references[0].contentLength = 13n;
    if (fault === 'identity') f.metadata.provenance[0].identity = 'clubmedia:other';
    if (fault === 'duplicate') f.metadata.provenance.push(f.metadata.provenance[0]);
    if (fault === 'count') f.storage.encryptedObjects = 0;
    expect(() => reconcileMediaAuthority(f.storage, f.metadata, f.authorities)).toThrow();
  });
});
