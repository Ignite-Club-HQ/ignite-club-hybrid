/** Operator-only consensus reads. Registry authenticity/completeness is supplied
 * by the deployment inventory adapter, never inferred from browser config.
 * Blob paths cover all club upload categories, including unreferenced objects.
 * This is storage evidence, not metadata reconciliation or move permission. */
type Phase = { legacy: null } | { indexed: null } | { pending: null } | { journal: null } | { done: null };
type Cursor = { phase: Phase; offset: bigint; after: string };
type Entry = {
  kind: { blob: null } | { pending: null } | { journal: null };
  path: string; upload_id: string; content_hash: string; content_length: bigint; unsettled: boolean;
};
type Page = {
  revision: bigint; fenced: boolean; fence_revision: [] | [bigint];
  quota_shared: boolean; quota_authority: [] | [{ toText(): string }];
  entries: Entry[]; next: [] | [Cursor]; scanned: bigint;
};
export type MediaInventoryActor = {
  club_media_inventory_page(club: string, cursor: Cursor, revision: [] | [bigint]): Promise<{ Ok: Page } | { Err: string }>;
};
export type StoreInventoryBinding = { canisterId: string; quotaAuthority: string; actor: MediaInventoryActor };
export type StoreInventoryRegistry = {
  deploymentId: string; revision: string; complete: boolean; stores: StoreInventoryBinding[];
};
export type StoredClubInventory = {
  deploymentId: string; registryRevision: string; clubId: string;
  stores: { canisterId: string; revision: bigint; fenceRevision: bigint; entries: Entry[] }[];
  encryptedObjects: number; pendingUploads: number;
};
const start: Cursor = { phase: { legacy: null }, offset: 0n, after: '' };
const end: Cursor = { phase: { done: null }, offset: 0n, after: '' };
const unwrap = (r: { Ok: Page } | { Err: string }) => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const cursorKey = (c: Cursor) => `${Object.keys(c.phase).join(',')}:${c.offset}:${c.after}`;
function checkPage(p: Page, store: StoreInventoryBinding, revision?: bigint, fence?: bigint) {
  if (p.scanned < 0n || p.scanned > 200n || p.entries.length > 200 || BigInt(p.entries.length) > p.scanned)
    throw new Error('Unbounded or invalid media inventory page');
  if (!p.fenced || p.fence_revision.length !== 1) throw new Error('Club media must be fenced for inventory');
  if (!p.quota_shared || p.quota_authority[0]?.toText() !== store.quotaAuthority)
    throw new Error('Shared media quota authority mismatch');
  if (revision !== undefined && p.revision !== revision) throw new Error('Media inventory changed');
  if (fence !== undefined && p.fence_revision[0] !== fence) throw new Error('Media fence changed');
}
const phases = ['legacy', 'indexed', 'pending', 'journal', 'done'];
function phaseIndex(c: Cursor) {
  const keys = Object.keys(c.phase);
  const index = phases.indexOf(keys[0]);
  if (keys.length !== 1 || index < 0 || c.offset < 0n || c.after.length > 1024 ||
      ((index === 0 || index === 2) && c.after !== '') ||
      ((index === 1 || index === 3 || index === 4) && c.offset !== 0n) ||
      (index === 4 && c.after !== '')) throw new Error('Invalid media inventory cursor');
  return index;
}
function checkProgress(cursor: Cursor, page: Page) {
  const index = phaseIndex(cursor); const next = page.next[0];
  if (index === 4) {
    if (next || page.entries.length || page.scanned !== 0n) throw new Error('Invalid terminal media inventory');
    return;
  }
  if (!next) throw new Error('Premature media inventory completion');
  const nextIndex = phaseIndex(next);
  if (nextIndex !== index && nextIndex !== index + 1) throw new Error('Media inventory skipped a phase');
  if (nextIndex === index) {
    if (page.scanned !== 200n ||
        ((index === 0 || index === 2) && next.offset !== cursor.offset + page.scanned) ||
        ((index === 1 || index === 3) && next.after <= cursor.after)) throw new Error('Media inventory cursor stalled');
  } else if (next.offset !== 0n || next.after !== '') throw new Error('Invalid media phase start');
}
/** Keep every store fenced until the transfer has safely completed or aborted.
 * Reject all partial scans. Final consensus re-reads bind all stores and registry
 * to the same fenced interval; controllers must remain exclusively fenced. */
export async function readFencedClubStoreInventory(
  clubId: string, deploymentId: string, readRegistry: () => Promise<StoreInventoryRegistry>,
): Promise<StoredClubInventory> {
  if (!clubId || clubId.includes('/') || clubId.length > 128) throw new Error('Invalid club id');
  const registry = await readRegistry();
  const ids = registry.stores.map(s => s.canisterId);
  if (!registry.complete || registry.deploymentId !== deploymentId || !registry.revision || !ids.length ||
      new Set(ids).size !== ids.length || registry.stores.some(s => !s.canisterId || !s.quotaAuthority))
    throw new Error('Complete authenticated media store registry required');
  const stores = await Promise.all(registry.stores.map(async store => {
    let cursor = start; let revision: bigint | undefined; let fenceRevision: bigint | undefined;
    const entries: Entry[] = []; const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const key = cursorKey(cursor);
      if (seen.has(key)) throw new Error('Media inventory cursor stalled');
      seen.add(key);
      const page = unwrap(await store.actor.club_media_inventory_page(clubId, cursor, revision === undefined ? [] : [revision]));
      checkPage(page, store, revision, fenceRevision);
      checkProgress(cursor, page);
      revision = page.revision; fenceRevision = page.fence_revision[0];
      for (const entry of page.entries) {
        if (!entry.path.startsWith(`clubs/${clubId}/`) || entry.content_length < 0n ||
            (('blob' in entry.kind) && (entry.unsettled || !/^[a-f0-9]{64}$/.test(entry.content_hash))) ||
            (!('blob' in entry.kind) && (!entry.unsettled || !entry.upload_id)))
          throw new Error('Invalid or foreign-club media inventory entry');
        entries.push(entry);
      }
      const next = page.next[0];
      if (!next) {
        if (revision === undefined || fenceRevision === undefined) throw new Error('Incomplete media inventory');
        const blobs = entries.filter(e => 'blob' in e.kind).map(e => e.path);
        if (new Set(blobs).size !== blobs.length) throw new Error('Duplicate media blob inventory');
        return { canisterId: store.canisterId, revision, fenceRevision, entries };
      }
      cursor = next;
    }
    throw new Error('Media inventory exceeds page budget');
  }));
  const fresh = await readRegistry();
  const inventoryKey = (r: StoreInventoryRegistry) => r.stores.map(s => `${s.canisterId}|${s.quotaAuthority}`).sort().join(',');
  if (!fresh.complete || fresh.deploymentId !== deploymentId || fresh.revision !== registry.revision || inventoryKey(fresh) !== inventoryKey(registry))
    throw new Error('Media store registry changed');
  await Promise.all(stores.map(async result => {
    const binding = registry.stores.find(s => s.canisterId === result.canisterId);
    if (!binding) throw new Error('Missing inventory store');
    const terminal = unwrap(await binding.actor.club_media_inventory_page(clubId, end, [result.revision]));
    checkPage(terminal, binding, result.revision, result.fenceRevision);
    checkProgress(end, terminal);
  }));
  return { deploymentId, registryRevision: registry.revision, clubId, stores,
    encryptedObjects: stores.reduce((n, s) => n + s.entries.filter(e => 'blob' in e.kind).length, 0),
    pendingUploads: stores.reduce((n, s) => n + new Set(s.entries.filter(e => e.unsettled).map(e => e.upload_id)).size, 0) };
}