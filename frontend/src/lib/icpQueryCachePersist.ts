/**
 * Instant page opens in ICP mode: keeps a copy of the react-query cache in
 * IndexedDB so the next visit to any page paints the last-seen data at once
 * while canister reads refresh it in the background (stale-while-revalidate).
 *
 * - ICP mode only, scoped to the signed-in Internet Identity principal; a
 *   different principal (or none) never sees another user's copy.
 * - Cleared on sign-out (clearPersistedIcpQueryCache).
 * - IndexedDB structured clone keeps BigInt / Uint8Array intact. Queries
 *   holding class instances (Principal, Blob, …) are skipped, since clone
 *   would strip their methods. Media/URL/key queries are never stored.
 */
import { dehydrate, hydrate, type QueryClient, type Query } from "@tanstack/react-query";

const DB = "ignite-icp-query-cache";
const STORE = "kv";
const KEY = "cache-v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 1500;
const SKIP_KEY = /media-feed|photos|signed|photo-url|blob|media-url|vetkey|secret|token|decrypt/i;

interface Stored { owner: string; savedAt: number; state: ReturnType<typeof dehydrate> }

function currentPrincipal(): string | null {
  try {
    const raw = localStorage.getItem("ignite_icp_internet_identity_session");
    const parsed = raw ? (JSON.parse(raw) as { principal?: unknown }) : null;
    return typeof parsed?.principal === "string" ? parsed.principal : null;
  } catch {
    return null;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

function isPlain(value: unknown, depth = 0): boolean {
  // Object URLs (decrypted photos) die with the page — never persist them.
  if (typeof value === "string") return !value.startsWith("blob:");
  if (value == null || typeof value !== "object") return typeof value !== "function" && typeof value !== "symbol";
  if (depth > 12) return false;
  if (value instanceof Date || ArrayBuffer.isView(value)) return true;
  if (Array.isArray(value)) return value.every((v) => isPlain(v, depth + 1));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value as Record<string, unknown>).every((v) => isPlain(v, depth + 1));
}

function shouldPersist(query: Query): boolean {
  if (query.state.status !== "success" || query.state.data === undefined) return false;
  if (SKIP_KEY.test(JSON.stringify(query.queryKey, (_k, v) => (typeof v === "bigint" ? String(v) : v)))) return false;
  return isPlain(query.state.data);
}

/** Restore the cached pages before first render (bounded wait). */
export async function restoreIcpQueryCache(client: QueryClient, isIcp: boolean, maxWaitMs = 400): Promise<void> {
  if (!isIcp || typeof indexedDB === "undefined") return;
  const owner = currentPrincipal();
  if (!owner) return;
  const work = (async () => {
    try {
      const stored = await idb<Stored | undefined>("readonly", (s) => s.get(KEY));
      if (!stored || stored.owner !== owner || Date.now() - stored.savedAt > MAX_AGE_MS) return;
      hydrate(client, stored.state);
    } catch {
      /* cache is best-effort */
    }
  })();
  await Promise.race([work, new Promise((r) => setTimeout(r, maxWaitMs))]);
}

/** Keep the IndexedDB copy in sync with the live cache (debounced). */
export function startIcpQueryCachePersist(client: QueryClient, isIcp: boolean): void {
  if (!isIcp || typeof indexedDB === "undefined") return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const owner = currentPrincipal();
    if (!owner) return;
    try {
      const state = dehydrate(client, { shouldDehydrateQuery: shouldPersist });
      const value: Stored = { owner, savedAt: Date.now(), state };
      void idb("readwrite", (s) => s.put(value, KEY)).catch(() => undefined);
    } catch {
      /* skip this round */
    }
  };
  client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && timer) {
      clearTimeout(timer);
      save();
    }
  });
}

export async function clearPersistedIcpQueryCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await idb("readwrite", (s) => s.delete(KEY));
  } catch {
    /* ignore */
  }
}
