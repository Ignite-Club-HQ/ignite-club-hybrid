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

const CLUB_KEY_PREFIX = "ignite.clubkey.v1:";
export const CLUB_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PHOTO_CACHE_PREFIX = "ignite-media-v1:";
const PHOTO_CACHE_MAX_BYTES = 8 * 1024 * 1024;

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
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export async function writeCachedPhoto(principal: string, canisterId: string, path: string, bytes: ArrayBuffer): Promise<void> {
  if (typeof caches === "undefined" || bytes.byteLength > PHOTO_CACHE_MAX_BYTES) return;
  try {
    const cache = await caches.open(photoCacheName(principal));
    await cache.put(photoRequest(canisterId, path), new Response(bytes));
  } catch {
    /* quota — skip */
  }
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
  if (typeof caches === "undefined") return;
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith(PHOTO_CACHE_PREFIX)) await caches.delete(name);
    }
  } catch {
    /* ignore */
  }
}
