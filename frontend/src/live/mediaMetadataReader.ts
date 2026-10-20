/** Complete consensus reader. Locations resolve references only; legacy
 * encryption provenance must be independently attested, never inferred. */
import { MEDIA_REFERENCE_DOMAINS, type MediaMetadataEvidence } from './mediaAuthorityReconciliation';
import type { StoredClubInventory } from './mediaStoreInventory';
export type MediaReferencePage = { revision: bigint; scanned: bigint; next: [] | [bigint]; references: {
  resource_id: string; url: string; store: [] | [string]; path: [] | [string]; content_hash: [] | [string];
}[] };
export type MediaReferenceActor = { read_club_media_references(club: string, offset: bigint, expected: [] | [bigint]): Promise<{ Ok: MediaReferencePage } | { Err: string }> };
const unwrap = <T>(r: { Ok: T } | { Err: string }) => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
export async function readCompleteMediaMetadata(storage: StoredClubInventory, d: {
  actors: Record<typeof MEDIA_REFERENCE_DOMAINS[number], MediaReferenceActor>;
  /** Every provenance row must originate from authenticated upload/legacy
   * attestation records bound to ciphertext hash and original public key. */
  readProvenance(): Promise<MediaMetadataEvidence['provenance']>;
}): Promise<MediaMetadataEvidence> {
  const objects = new Map(storage.stores.flatMap(s => s.entries.filter(e => 'blob' in e.kind).map(e =>
    [JSON.stringify([s.canisterId, e.path]), { ...e, storeId: s.canisterId }] as const)));
  const references: MediaMetadataEvidence['references'] = [];
  const domains: MediaMetadataEvidence['domains'] = [];
  for (const domain of MEDIA_REFERENCE_DOMAINS) {
    const actor = d.actors[domain]; let offset = 0n; let revision: bigint | undefined;
    const seen = new Set<string>();
    for (let pages = 0; ; pages++) {
      if (pages >= 100_000) throw new Error('Media metadata page budget exceeded');
      const p = unwrap(await actor.read_club_media_references(storage.clubId, offset, revision === undefined ? [] : [revision]));
      if (p.revision < 0n || p.scanned < 0n || p.scanned > 200n || revision !== undefined && revision !== p.revision ||
          p.next.length && (p.next[0] !== offset + p.scanned || p.next[0] <= offset || p.scanned === 0n))
        throw new Error('Changed or invalid media metadata page');
      revision = p.revision;
      for (const r of p.references) {
        if (!r.resource_id || seen.has(r.resource_id)) throw new Error('Duplicate media resource'); seen.add(r.resource_id);
        let store = r.store[0]; let path = r.path[0];
        if (Boolean(store) !== Boolean(path)) throw new Error('Partial blob reference');
        if (!store) {
          let url: URL; try { url = new URL(r.url); } catch {
            // Plain paths require a unique registered object match; never
            // invent authority or encryption mode from that match.
            const matches = [...objects.values()].filter(o => o.path === r.url);
            if (matches.length !== 1) throw new Error('Unresolved media reference');
            store = matches[0]?.storeId; path = matches[0]?.path;
            url = new URL('https://invalid.invalid');
          }
          if (!store) {
            const sub = /^([a-z0-9-]+)\.(?:raw\.)?icp0\.io$/.exec(url.hostname)?.[1];
            if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe media URL');
            if (sub) { store = sub; path = decodeURIComponent(url.pathname.replace(/^\/+/, '')); }
            else if (url.hostname === 'icp0.io' || url.hostname === 'raw.icp0.io') {
              const segments = url.pathname.replace(/^\/+/, '').split('/'); store = segments.shift(); path = segments.join('/');
            } else { throw new Error('External media reference needs explicit inventory classification'); }
          }
        }
        const blob = objects.get(JSON.stringify([store, path]));
        if (!blob || r.content_hash[0] && r.content_hash[0] !== blob.content_hash) throw new Error('Media reference ciphertext mismatch');
        references.push({ domain, resourceId: r.resource_id, storeId: blob.storeId, path: blob.path, contentHash: blob.content_hash, contentLength: blob.content_length });
      }
      if (!p.next.length) break;
      offset = p.next[0];
    }
    if (revision === undefined) throw new Error('Missing metadata revision');
    const confirm = unwrap(await actor.read_club_media_references(storage.clubId, 0n, [revision]));
    if (confirm.revision !== revision) throw new Error('Media metadata changed during confirmation');
    domains.push({ domain, revision: revision.toString(), fenced: true });
  }
  const provenance = await d.readProvenance();
  for (const domain of domains) {
    const p = unwrap(await d.actors[domain.domain].read_club_media_references(storage.clubId, 0n, [BigInt(domain.revision)]));
    if (p.revision.toString() !== domain.revision) throw new Error('Media metadata changed after provenance reads');
  }
  return { deploymentId: storage.deploymentId, registryRevision: storage.registryRevision, clubId: storage.clubId,
    complete: true, domains, references, provenance };
}