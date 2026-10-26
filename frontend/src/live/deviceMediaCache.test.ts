// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDeviceCachedPhotos, readCachedPhoto, writeCachedPhoto } from './deviceMediaCache';
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
      writeCachedPhoto(i % 2 ? 'bob' : 'alice', 'store', `photo-${i}`, new ArrayBuffer(6 * 1024 * 1024))));
    let size = 0;
    for (const rows of stores.values()) for (const response of rows.values()) size += Number(response.headers.get('x-ignite-bytes'));
    expect(size).toBeLessThanOrEqual(VIEWED_PHOTO_CACHE_BYTES);
    expect(await readCachedPhoto('alice', 'store', 'photo-0')).toBeNull();
    expect(await readCachedPhoto('alice', 'store', 'photo-4')).not.toBeNull();
    expect(await readCachedPhoto('bob', 'store', 'photo-4')).toBeNull();
  });
  it('keeps at most 100 viewed photos', async () => {
    const stores = photoStorage();
    for (let i = 0; i < 105; i++) await writeCachedPhoto('alice', 'store', String(i), new ArrayBuffer(1));
    expect([...stores.values()].reduce((sum, rows) => sum + rows.size, 0)).toBe(100);
  });
  it('rejects individual photos over 8 MiB', async () => {
    const stores = photoStorage();
    await writeCachedPhoto('alice', 'store', 'large', new ArrayBuffer(8 * 1024 * 1024 + 1));
    expect(stores.size).toBe(0);
  });
  it('clears photos but preserves retained keys and unrelated browser caches', async () => {
    const stores = photoStorage();
    localStorage.setItem('ignite.clubkey.v1:alice', 'key');
    stores.set('app-code', new Map());
    await writeCachedPhoto('alice', 'store', 'photo', new ArrayBuffer(1));
    await clearDeviceCachedPhotos();
    expect(await readCachedPhoto('alice', 'store', 'photo')).toBeNull();
    expect(localStorage.getItem('ignite.clubkey.v1:alice')).toBe('key');
    expect(stores.has('app-code')).toBe(true);
  });
});