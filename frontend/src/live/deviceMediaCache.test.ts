// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDeviceCachedPhotos, clearStoredDeviceKeys, pruneCachedPhotosForClubs, pruneDeviceCachedPhotos, readCachedPhoto, writeCachedPhoto } from './deviceMediaCache';
const LOCK = { clubId: 'club-a', piiCanisterId: 'pii' };
import { VIEWED_PHOTO_CACHE_BYTES } from '@/lib/deviceCacheBudget';
function photoStorage() {
  const stores = new Map<string, Map<string, Response>>();
  vi.stubGlobal('caches', {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      let rows = stores.get(name);
      if (!rows) { rows = new Map(); stores.set(name, rows); }
      const data = rows;
      const url = (key: string | Request) => typeof key === 'string' ? key : key.url;
      return {
        keys: async () => [...data.keys()].map(key => new Request(key)),
        match: async (key: string | Request) => data.get(url(key))?.clone(),
        delete: async (key: string | Request) => data.delete(url(key)),
        put: async (key: string | Request, value: Response) => { data.set(url(key), value.clone()); },
      };
    },
  });
  return stores;
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe('bounded viewed-photo storage', () => {
  it('serializes concurrent saves and evicts oldest photos at 20 MiB across accounts', async () => {
    const stores = photoStorage();
    await Promise.all(Array.from({ length: 5 }, (_, i) =>
      writeCachedPhoto(i % 2 ? 'bob' : 'alice', 'store', `photo-${i}`, new ArrayBuffer(6 * 1024 * 1024), LOCK)));
    let size = 0;
    for (const rows of stores.values()) for (const response of rows.values()) size += Number(response.headers.get('x-ignite-bytes'));
    expect(size).toBeLessThanOrEqual(VIEWED_PHOTO_CACHE_BYTES);
    expect(await readCachedPhoto('alice', 'store', 'photo-0')).toBeNull();
    expect(await readCachedPhoto('alice', 'store', 'photo-4')).not.toBeNull();
    expect(await readCachedPhoto('bob', 'store', 'photo-4')).toBeNull();
  });
  it('keeps at most 100 viewed photos', async () => {
    const stores = photoStorage();
    for (let i = 0; i < 105; i++) await writeCachedPhoto('alice', 'store', String(i), new ArrayBuffer(1), LOCK);
    expect([...stores.values()].reduce((sum, rows) => sum + rows.size, 0)).toBe(100);
  });
  it('rejects individual photos over 8 MiB', async () => {
    const stores = photoStorage();
    await writeCachedPhoto('alice', 'store', 'large', new ArrayBuffer(8 * 1024 * 1024 + 1), LOCK);
    expect(stores.size).toBe(0);
  });
  it('removes photos older than seven days on reading', async () => {
    const stores = photoStorage();
    await writeCachedPhoto('alice', 'store', 'old', new ArrayBuffer(1), LOCK);
    const rows = stores.get('ignite-media-v2:alice');
    if (!rows) throw new Error('missing cache');
    const key = [...rows.keys()][0];
    if (!key) throw new Error('missing photo');
    rows.set(key, new Response(new ArrayBuffer(1), { headers: {
      'x-ignite-bytes': '1', 'x-ignite-saved-at': String(Date.now() - 8 * 86400000), 'x-ignite-club': 'club-a', 'x-ignite-pii': 'pii',
    } }));
    expect(await readCachedPhoto('alice', 'store', 'old')).toBeNull();
    expect(rows.size).toBe(0);
  });
  it('clears photos but preserves retained keys and unrelated browser caches', async () => {
    const stores = photoStorage();
    localStorage.setItem('ignite.clubkey.v1:alice', 'key');
    stores.set('app-code', new Map());
    await writeCachedPhoto('alice', 'store', 'photo', new ArrayBuffer(1), LOCK);
    await clearDeviceCachedPhotos();
    expect(await readCachedPhoto('alice', 'store', 'photo')).toBeNull();
    expect(localStorage.getItem('ignite.clubkey.v1:alice')).toBe('key');
    expect(stores.has('app-code')).toBe(true);
  });
});
describe('saved key copies', () => {
  it('removes key copies without touching photo bytes or unrelated storage', async () => {
    const stores = photoStorage();
    localStorage.setItem('ignite.clubkey.v1:alice', 'key');
    localStorage.setItem('ignite-drafts', 'draft');
    await writeCachedPhoto('alice', 'store', 'photo', new ArrayBuffer(1), LOCK);
    clearStoredDeviceKeys();
    expect(localStorage.getItem('ignite.clubkey.v1:alice')).toBeNull();
    expect(localStorage.getItem('ignite-drafts')).toBe('draft');
    expect(await readCachedPhoto('alice', 'store', 'photo')).not.toBeNull();
    expect(stores.has('ignite-media-v2:alice')).toBe(true);
  });
});
describe('encrypted saved photos', () => {
  it('returns the saved bytes unchanged with the club key slot that unlocks them', async () => {
    photoStorage();
    await writeCachedPhoto('alice', 'store', 'clubs/club-a/p.jpg', new Uint8Array([9, 8, 7]).buffer, LOCK);
    const saved = await readCachedPhoto('alice', 'store', 'clubs/club-a/p.jpg');
    expect(saved?.clubId).toBe('club-a');
    expect(saved?.piiCanisterId).toBe('pii');
    expect([...(saved?.ciphertext ?? [])]).toEqual([9, 8, 7]);
  });
  it('deletes older viewable photo copies left by previous versions', async () => {
    const stores = photoStorage();
    stores.set('ignite-media-v1:alice', new Map([['https://x/p', new Response('plain')]]));
    await pruneDeviceCachedPhotos();
    expect(stores.has('ignite-media-v1:alice')).toBe(false);
  });
  it('removes saved photos of a club the person has left, keeping other clubs', async () => {
    photoStorage();
    await writeCachedPhoto('alice', 'store', 'a', new ArrayBuffer(1), LOCK);
    await writeCachedPhoto('alice', 'store', 'b', new ArrayBuffer(1), { clubId: 'club-b', piiCanisterId: 'pii' });
    await pruneCachedPhotosForClubs('alice', ['club-b']);
    expect(await readCachedPhoto('alice', 'store', 'a')).toBeNull();
    expect(await readCachedPhoto('alice', 'store', 'b')).not.toBeNull();
  });
});

import { MAX_STORED_RECORD_KEYS, storeClubKey as storeKeyBound, loadStoredClubKey as loadKeyBound } from "./deviceMediaCache";
import { it as itBound, expect as expectBound } from "vitest";
itBound("keeps at most MAX_STORED_RECORD_KEYS record keys per sign-in", () => {
  localStorage.clear();
  for (let i = 0; i <= MAX_STORED_RECORD_KEYS; i++) storeKeyBound("c", "p", `pii:name:${i}`, new Uint8Array([1]));
  expectBound(Object.keys(localStorage).filter(k => k.includes(":p:pii:")).length).toBe(MAX_STORED_RECORD_KEYS);
  expectBound(loadKeyBound("c", "p", `pii:name:${MAX_STORED_RECORD_KEYS}`)).not.toBeNull();
});
