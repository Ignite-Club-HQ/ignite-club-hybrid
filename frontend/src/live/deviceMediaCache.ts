/**
 * On-device caches that make club photos load fast on repeat visits:
 *  - club photo keys (48-byte vetKeys) persisted for CLUB_KEY_TTL_MS, so a
 *    returning member skips the paid, slow key fetch entirely;
 *  - still-encrypted club photo bytes in the Cache API, so a photo seen before
 *    opens without downloading; it is unlocked in memory with the saved club
 *    key only when shown. No viewable photo is ever written to the device.
 * Both are scoped to the signed-in principal. Saved photo copies are wiped
 * on sign-out; key copies stay for their 30-day life, because a key decrypts
 * nothing by itself — the ciphertext is read again through an authorized read
 * on every open. The explicit "remove saved copies" action calls
 * clearStoredDeviceKeys(). Removal: pruneStoredClubKeys plus
 * pruneCachedPhotosForClubs drop a removed club's key and saved photos.
 */

import { VIEWED_PHOTO_CACHE_BYTES } from '@/lib/deviceCacheBudget';

const CLUB_KEY_PREFIX = "ignite.clubkey.v1:";
export const CLUB_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PHOTO_CACHE_PREFIX = "ignite-media-v2:";
// Any earlier generation held viewable (decrypted) photos: always delete it.
const ANY_PHOTO_CACHE = "ignite-media-v";
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

/** Most record (pii:) keys kept per sign-in; oldest-expiring are dropped first. */
export const MAX_STORED_RECORD_KEYS = 300;

function boundRecordKeys(canisterId: string, principal: string): void {
  const prefix = `${CLUB_KEY_PREFIX}${canisterId}:${principal}:pii:`;
  const rows: { name: string; exp: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    if (!name?.startsWith(prefix)) continue;
    let exp = 0;
    try { exp = (JSON.parse(localStorage.getItem(name) ?? "{}") as { exp?: number }).exp ?? 0; } catch { /* drop first */ }
    rows.push({ name, exp });
  }
  if (rows.length < MAX_STORED_RECORD_KEYS) return;
  rows.sort((a, b) => a.exp - b.exp);
  for (const row of rows.slice(0, rows.length - MAX_STORED_RECORD_KEYS + 1)) localStorage.removeItem(row.name);
}

export function storeClubKey(canisterId: string, principal: string, clubId: string, key: Uint8Array): void {
  try {
    if (clubId.startsWith("pii:")) boundRecordKeys(canisterId, principal);
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

/** Club id a stored key belongs to, or null for person-scoped keys (pii:...). */
export function storedKeyClubId(slot: string): string | null {
  if (slot.startsWith("pii:")) return null;
  if (slot.startsWith("shared:")) { const c = slot.slice(7).split(":")[0]; return c || null; }
  const marker = ":clubnames:";
  const i = slot.lastIndexOf(marker);
  if (slot.startsWith("private-club-name:")) return i >= 0 ? slot.slice(i + marker.length) : null;
  return slot || null; // club photo keys are stored under the bare club id
}

/** Removes this sign-in's saved club name/photo keys for clubs not in `clubIds`. */
export function pruneStoredClubKeys(principal: string, clubIds: readonly string[]): number {
  const keep = new Set(clubIds);
  let removed = 0;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const name = localStorage.key(i);
      if (!name?.startsWith(CLUB_KEY_PREFIX)) continue;
      const rest = name.slice(CLUB_KEY_PREFIX.length);
      const first = rest.indexOf(":");
      const second = first < 0 ? -1 : rest.indexOf(":", first + 1);
      if (second < 0 || rest.slice(first + 1, second) !== principal) continue;
      const club = storedKeyClubId(rest.slice(second + 1));
      if (club && !keep.has(club)) { localStorage.removeItem(name); removed++; }
    }
  } catch {
    /* ignore */
  }
  return removed;
}

function photoCacheName(principal: string): string {
  return `${PHOTO_CACHE_PREFIX}${principal}`;
}
function photoRequest(canisterId: string, path: string): string {
  return `https://ignite-media.local/${canisterId}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export interface CachedPhotoLock { clubId: string; piiCanisterId: string }
export interface CachedPhoto extends CachedPhotoLock { ciphertext: Uint8Array }

/** Still-encrypted saved copy plus the club key slot that unlocks it. */
export async function readCachedPhoto(principal: string, canisterId: string, path: string): Promise<CachedPhoto | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(photoCacheName(principal));
    const hit = await cache.match(photoRequest(canisterId, path));
    if (hit && Date.now() - Number(hit.headers.get('x-ignite-saved-at') ?? 0) > PHOTO_TTL_MS) {
      await cache.delete(photoRequest(canisterId, path));
      return null;
    }
    if (!hit) return null;
    const clubId = hit.headers.get('x-ignite-club'), piiCanisterId = hit.headers.get('x-ignite-pii');
    if (!clubId || !piiCanisterId) { await cache.delete(photoRequest(canisterId, path)); return null; }
    return { ciphertext: new Uint8Array(await hit.arrayBuffer()), clubId, piiCanisterId };
  } catch {
    return null;
  }
}

async function trimPhotos(incomingBytes: number, incomingCount: number): Promise<void> {
  const rows: Array<{ cache: Cache; request: Request; bytes: number; savedAt: number }> = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(ANY_PHOTO_CACHE)) continue;
    if (!name.startsWith(PHOTO_CACHE_PREFIX)) { await caches.delete(name); continue; }
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

/** Saves the ENCRYPTED bytes only; never pass decrypted photo bytes here. */
export function writeCachedPhoto(principal: string, canisterId: string, path: string, bytes: ArrayBuffer, lock: CachedPhotoLock): Promise<void> {
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
      'x-ignite-club': lock.clubId, 'x-ignite-pii': lock.piiCanisterId,
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
      if (name.startsWith(ANY_PHOTO_CACHE)) await caches.delete(name);
    }
  });
  return photoWork;
}

/** Removal cleanup: deletes this sign-in's saved photos for clubs not in `clubIds`. */
export function pruneCachedPhotosForClubs(principal: string, clubIds: readonly string[]): Promise<void> {
  const keep = new Set(clubIds);
  photoWork = photoWork.then(async () => {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(photoCacheName(principal));
    for (const request of await cache.keys()) {
      const club = (await cache.match(request))?.headers.get('x-ignite-club');
      if (!club || !keep.has(club)) await cache.delete(request);
    }
  }).catch(() => { /* best effort */ });
  return photoWork;
}

export function pruneDeviceCachedPhotos(): Promise<void> {
  photoWork = photoWork.then(async () => {
    if (typeof caches !== 'undefined') await trimPhotos(0, 0);
  }).catch(() => { /* best effort */ });
  return photoWork;
}

/** Removes every saved key copy (photo bytes untouched) — the explicit
 * "remove saved copies" action, so retained keys stay removable. */
export function clearStoredDeviceKeys(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(CLUB_KEY_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/** Removes every saved club key copy and saved photo copy. */
export async function clearDeviceMediaCaches(): Promise<void> {
  clearStoredDeviceKeys();
  try {
    await clearDeviceCachedPhotos();
  } catch {
    /* ignore */
  }
}
