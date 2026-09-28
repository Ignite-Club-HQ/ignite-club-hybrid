import { describe, expect, it } from 'vitest';

type MediaCacheEntry = {
  key: string;
  etag: string;
  expiresAt: number;
  size: number;
};

function createMediaCache() {
  return new Map<string, MediaCacheEntry>();
}

function setMediaCache(cache: Map<string, MediaCacheEntry>, key: string, entry: MediaCacheEntry) {
  if (!key.startsWith('club/')) {
    throw new Error('media cache namespace required');
  }
  cache.set(key, entry);
  return entry;
}

function readMediaCache(cache: Map<string, MediaCacheEntry>, key: string) {
  const entry = cache.get(key);
  if (!entry) {
    return { ok: false, reason: 'missing-entry' } as const;
  }
  if (Date.now() > entry.expiresAt) {
    return { ok: false, reason: 'expired' } as const;
  }
  return { ok: true, entry } as const;
}

describe('media cache contract guard', () => {
  it('requires namespace-scoped keys and rejects expired or missing cache entries', () => {
    const cache = createMediaCache();
    const entry = { key: 'club/club-1/media-hero.jpg', etag: 'etag-1', expiresAt: Date.now() + 60000, size: 4096 };
    setMediaCache(cache, entry.key, entry);

    expect(readMediaCache(cache, entry.key)).toMatchObject({ ok: true, entry: { etag: 'etag-1' } });
    expect(readMediaCache(cache, 'club/club-1/unknown.jpg')).toEqual({ ok: false, reason: 'missing-entry' });
    expect(() => setMediaCache(cache, 'user/club-1/media-hero.jpg', entry)).toThrow('media cache namespace required');
  });
});
