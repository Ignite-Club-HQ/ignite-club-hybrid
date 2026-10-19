import { describe, expect, it, vi } from 'vitest';
import { readCompleteMediaMetadata, type MediaReferencePage } from './mediaMetadataReader';
import type { StoredClubInventory } from './mediaStoreInventory';
const storage: StoredClubInventory = { deploymentId: 'd', registryRevision: '7', clubId: 'c', pendingUploads: 0, encryptedObjects: 1,
  stores: [{ canisterId: 's-cai', revision: 1n, fenceRevision: 2n,
    entries: [{ kind: { blob: null }, path: 'clubs/c/p', content_hash: 'a'.repeat(64), content_length: 12n, unsettled: false, upload_id: '' }] }] };
function fixture() {
  const page: MediaReferencePage = { revision: 2n, scanned: 1n, next: [], references: [] };
  const actor = { read_club_media_references: vi.fn(async () => ({ Ok: structuredClone(page) })) };
  return { page, actor, d: { actors: { gallery: actor, chat: actor, vault: actor, articles: actor }, readProvenance: async () => [] } };
}
describe('complete media metadata consensus reader', () => {
  it('scans all four domains and rechecks revisions without inventing provenance', async () => {
    const f = fixture(); const result = await readCompleteMediaMetadata(storage, f.d);
    expect(result.domains.map(d => d.domain)).toEqual(['gallery', 'chat', 'vault', 'articles']); expect(result.provenance).toEqual([]);
    expect(f.actor.read_club_media_references).toHaveBeenCalledTimes(12);
  });
  it('continues an empty nonterminal page', async () => {
    const f = fixture(); f.actor.read_club_media_references.mockResolvedValueOnce({ Ok: { ...f.page, scanned: 200n, next: [200n] } });
    await readCompleteMediaMetadata(storage, f.d); expect(f.actor.read_club_media_references.mock.calls[1]).toEqual(['c', 200n, [2n]]);
  });
  it('binds a URL to existing ciphertext, not to an inferred key', async () => {
    const f = fixture(); f.page.references = [{ resource_id: 'r', url: 'https://s-cai.raw.icp0.io/clubs/c/p', store: [], path: [], content_hash: [] }];
    const r = await readCompleteMediaMetadata(storage, f.d); expect(r.references[0]).toMatchObject({ storeId: 's-cai', contentLength: 12n }); expect(r.provenance).toEqual([]);
  });
  it('refuses missing ciphertext and unresolved external URLs', async () => {
    const f = fixture(); f.page.references = [{ resource_id: 'r', url: 'https://example.com/p', store: [], path: [], content_hash: [] }];
    await expect(readCompleteMediaMetadata(storage, f.d)).rejects.toThrow('classification');
  });
  it('rejects stalled pagination and changed revisions', async () => {
    const f = fixture(); f.page.next = [0n]; await expect(readCompleteMediaMetadata(storage, f.d)).rejects.toThrow('invalid');
    f.page.next = []; f.actor.read_club_media_references.mockResolvedValueOnce({ Ok: f.page }).mockResolvedValueOnce({ Ok: { ...f.page, revision: 9n } });
    // End-of-domain recheck is validated by the actor's expected revision.
    f.actor.read_club_media_references.mockRejectedValueOnce(new Error('revision changed'));
    await expect(readCompleteMediaMetadata(storage, f.d)).rejects.toThrow();
  });
});