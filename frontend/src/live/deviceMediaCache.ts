/**
 * On-device caches that make club photos load fast on repeat visits:
 *  - club photo keys (48-byte vetKeys) persisted for CLUB_KEY_TTL_MS, so a
 *    returning member skips the paid, slow key fetch entirely;
 *  - decrypted photo bytes in the Cache API, so a photo seen before opens
 *    without downloading or decrypting again.
 * Both are scoped to the signed-in principal and wiped on sign-out
 * (clearDeviceMediaCaches). Trade-off: a member removed from a club keeps
 * photo access on that device until their cached key expires.
 */

import { VIEWED_PHOTO_CACHE_BYTES } from '@/lib/deviceCacheBudget';

const CLUB_KEY_PREFIX = "ignite.clubkey.v1:";
export const CLUB_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PHOTO_CACHE_PREFIX = "ignite-media-v1:";
const PHOTO_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PHOTOS = 100;
let photoEpoch = 0;
let photoWork: Promise<void> = Promise.resolve();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function clubKeyName(canisterId: string, principal: string, clubId: string): string {
  return `${CLUB_KEY_PREFIX}${canisterId}:${principal}:${clubId}`;
}

export function loadStoredClubKey(canisterId: string, principal: string, clubId: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(clubKeyName(canisterId, principal, clubId));
    if (!raw) return null;
    const { k, exp } = JSON.parse(raw) as { k: string; exp: number };
    if (!k || typeof exp !== "number" || exp < Date.now()) {
      localStorage.removeItem(clubKeyName(canisterId, principal, clubId));
      return null;
    }
    return fromB64(k);
  } catch {
    return null;
  }
}

export function storeClubKey(canisterId: string, principal: string, clubId: string, key: Uint8Array): void {
  try {
    localStorage.setItem(
      clubKeyName(canisterId, principal, clubId),
      JSON.stringify({ k: toB64(key), exp: Date.now() + CLUB_KEY_TTL_MS }),
    );
  } catch {
    /* storage full / private mode — session cache still works */
  }
}

export function forgetStoredClubKey(canisterId: string, principal: string, clubId: string): void {
  try {
    localStorage.removeItem(clubKeyName(canisterId, principal, clubId));
  } catch {
    /* ignore */
  }
}

function photoCacheName(principal: string): string {
  return `${PHOTO_CACHE_PREFIX}${principal}`;
}
function photoRequest(canisterId: string, path: string): string {
  return `https://ignite-media.local/${canisterId}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function readCachedPhoto(principal: string, canisterId: string, path: string): Promise<Blob | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(photoCacheName(principal));
    const hit = await cache.match(photoRequest(canisterId, path));
    if (hit && Date.now() - Number(hit.headers.get('x-ignite-saved-at') ?? 0) > PHOTO_TTL_MS) {
      await cache.delete(photoRequest(canisterId, path));
      return null;
    }
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function trimPhotos(incomingBytes: number, incomingCount: number): Promise<void> {
  const rows: Array<{ cache: Cache; request: Request; bytes: number; savedAt: number }> = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(PHOTO_CACHE_PREFIX)) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response) continue;
      const savedAt = Number(response.headers.get('x-ignite-saved-at') ?? 0);
      const size = Number(response.headers.get('x-ignite-bytes') ?? 0);
      // Legacy unmeasured entries are disposable, not guessed into the budget.
      if (!size || !savedAt || !Number.isFinite(size) || Date.now() - savedAt > PHOTO_TTL_MS) {
        await cache.delete(request); continue;
      }
      rows.push({ cache, request, bytes: size, savedAt });
    }
  }
  let total = rows.reduce((sum, row) => sum + row.bytes, incomingBytes);
  let count = rows.length + incomingCount;
  for (const row of rows.sort((a, b) => a.savedAt - b.savedAt)) {
    if (total <= VIEWED_PHOTO_CACHE_BYTES && count <= MAX_PHOTOS) break;
    await row.cache.delete(row.request);
    total -= row.bytes; count--;
  }
}

export function writeCachedPhoto(principal: string, canisterId: string, path: string, bytes: ArrayBuffer): Promise<void> {
  if (typeof caches === 'undefined' || bytes.byteLength > PHOTO_CACHE_MAX_BYTES) return Promise.resolve();
  const epoch = photoEpoch;
  photoWork = photoWork.then(async () => {
    if (epoch !== photoEpoch) return;
    const cache = await caches.open(photoCacheName(principal));
    const request = photoRequest(canisterId, path);
    await cache.delete(request);
    await trimPhotos(bytes.byteLength, 1);
    if (epoch !== photoEpoch) return;
    await cache.put(request, new Response(bytes, { headers: {
      'x-ignite-bytes': String(bytes.byteLength), 'x-ignite-saved-at': String(Date.now()),
    } }));
  }).catch(() => { /* unavailable or full: live photo is unaffected */ });
  return photoWork;
}

/** Content-only cleanup preserves the intentionally retained club keys. */
export function clearDeviceCachedPhotos(): Promise<void> {
  photoEpoch++;
  photoWork = photoWork.then(async () => {
    if (typeof caches === 'undefined') return;
    for (const name of await caches.keys()) {
      if (name.startsWith(PHOTO_CACHE_PREFIX)) await caches.delete(name);
    }
  });
  return photoWork;
}

export function pruneDeviceCachedPhotos(): Promise<void> {
  photoWork = photoWork.then(async () => {
    if (typeof caches !== 'undefined') await trimPhotos(0, 0);
  }).catch(() => { /* best effort */ });
  return photoWork;
}

/** Wipes every cached club key and decrypted photo — call on sign-out. */
export async function clearDeviceMediaCaches(): Promise<void> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(CLUB_KEY_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  try {
    await clearDeviceCachedPhotos();
  } catch {
    /* ignore */
  }
}
