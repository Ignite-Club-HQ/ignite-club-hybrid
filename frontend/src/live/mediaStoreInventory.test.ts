import { describe, expect, it, vi } from 'vitest';
import { readFencedClubStoreInventory, type MediaInventoryActor, type StoreInventoryRegistry } from './mediaStoreInventory';
const hash = 'a'.repeat(64);
function fixture() {
  const page = { revision: 4n, fenced: true, fence_revision: [2n], quota_shared: true,
    quota_authority: [{ toText: () => 'quota' }], scanned: 3n, next: [], entries: [
      { kind: { blob: null }, path: 'clubs/c/chat/photo', upload_id: '', content_hash: hash, content_length: 8n, unsettled: false },
      { kind: { pending: null }, path: 'clubs/c/vault/file', upload_id: 'pending-1', content_hash: '', content_length: 8n, unsettled: true },
      { kind: { journal: null }, path: 'clubs/c/vault/file', upload_id: 'pending-1', content_hash: '', content_length: 8n, unsettled: true },
    ] };
  const call = vi.fn(async (_club, cursor, _revision) => {
    const phases = ['legacy', 'indexed', 'pending', 'journal', 'done'];
    const index = phases.indexOf(Object.keys(cursor.phase)[0]);
    return { Ok: { ...page, entries: index === 0 ? page.entries : [], scanned: index === 0 ? page.scanned : 0n,
      next: index === 4 ? [] : [{ phase: { [phases[index + 1]]: null }, offset: 0n, after: '' }] } };
  });
  const registry: StoreInventoryRegistry = { deploymentId: 'd', revision: 'r1', complete: true,
    stores: [{ canisterId: 'store-a', quotaAuthority: 'quota', actor: { club_media_inventory_page: call } as MediaInventoryActor }] };
  return { page, call, registry, read: vi.fn(async () => registry) };
}
describe('fenced media store inventory', () => {
  it('counts orphan ciphertext and deduplicates pending plus journal records', async () => {
    const f = fixture();
    const result = await readFencedClubStoreInventory('c', 'd', f.read);
    expect(result.encryptedObjects).toBe(1); expect(result.pendingUploads).toBe(1);
    expect(f.call.mock.calls[1][2]).toEqual([4n]);
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it('includes every registered store rather than the current club group only', async () => {
    const f = fixture(); f.registry.stores.push({ ...f.registry.stores[0], canisterId: 'store-b' });
    const result = await readFencedClubStoreInventory('c', 'd', f.read);
    expect(result.encryptedObjects).toBe(2); expect(result.pendingUploads).toBe(2);
  });
  it.each(['incomplete', 'deployment', 'duplicate', 'authority', 'unfenced', 'oversized', 'foreign', 'hash', 'registry-change', 'page-change', 'denied', 'stalled', 'premature', 'skipped', 'terminal-data'])('rejects %s evidence', async fault => {
    const f = fixture();
    if (fault === 'incomplete') f.registry.complete = false;
    if (fault === 'deployment') f.registry.deploymentId = 'other';
    if (fault === 'duplicate') f.registry.stores.push(f.registry.stores[0]);
    if (fault === 'authority') f.registry.stores[0].quotaAuthority = 'wrong';
    if (fault === 'unfenced') f.page.fenced = false;
    if (fault === 'oversized') f.page.scanned = 201n;
    if (fault === 'foreign') f.page.entries[0].path = 'clubs/other/photo';
    if (fault === 'hash') f.page.entries[0].content_hash = 'bad';
    if (fault === 'registry-change') f.read.mockImplementationOnce(async () => f.registry).mockImplementationOnce(async () => ({ ...f.registry, revision: 'r2' }));
    if (fault === 'page-change') f.call.mockImplementationOnce(async () => ({ Ok: f.page })).mockImplementationOnce(async () => ({ Ok: { ...f.page, revision: 5n } }));
    if (fault === 'denied') f.call.mockImplementation(async () => ({ Err: 'Governor required' }) as never);
    if (fault === 'stalled') f.call.mockImplementation(async () => ({ Ok: { ...f.page, next: [{ phase: { legacy: null }, offset: 0n, after: '' }] } }) as never);
    if (fault === 'premature') f.call.mockImplementation(async () => ({ Ok: f.page }));
    if (fault === 'skipped') f.call.mockImplementation(async () => ({ Ok: { ...f.page, next: [{ phase: { done: null }, offset: 0n, after: '' }] } }) as never);
    if (fault === 'terminal-data') {
      const real = f.call.getMockImplementation();
      f.call.mockImplementation(async (club, cursor, revision) => {
        if ('done' in cursor.phase) return { Ok: f.page };
        if (!real) throw new Error('Missing fixture implementation');
        return real(club, cursor, revision);
      });
    }
    await expect(readFencedClubStoreInventory('c', 'd', f.read)).rejects.toThrow();
  });
});