/** Bounded, per-query ICP snapshots. No whole-cache clone on a navigation tap. */
import { ICP_READ_CACHE_BYTES } from './deviceCacheBudget';
import { hydrate, type DehydratedState, type QueryClient, type Query } from '@tanstack/react-query';

const DB = 'ignite-icp-query-cache';
const STORE = 'queries-v3';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUERIES = 100;
const MAX_QUERY_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = ICP_READ_CACHE_BYTES;
const SKIP_KEY = /media-feed|photos|signed|photo-url|blob|media-url|vetkey|secret|token|decrypt|private.*profile|display.names|roster.*names/i;
type Snapshot = DehydratedState['queries'][number];
interface Stored { scope: string; savedAt: number; bytes: number; snapshot: Snapshot }
type ScopeReader = () => string | null;
/** Prefer primary page inventories to incidental widgets within startup's time budget. */
export function savedPagePriority(key: readonly unknown[]): number {
  const name = typeof key[0] === 'string' ? key[0] : '';
  return /^(events|clubs|team|club|my-teams|vault-|next-up|user-memberships-for-events|user-clubs-for-filter)/.test(name) ? 1 : 0;
}
const active = new Map<QueryClient, () => void>();
const resetters = new Map<QueryClient, () => void>();
let generation = 0;

function currentPrincipal(): string | null {
  try {
    const raw = localStorage.getItem('ignite_icp_internet_identity_session');
    const parsed = raw ? JSON.parse(raw) as { principal?: unknown } : null;
    return typeof parsed?.principal === 'string' ? parsed.principal : null;
  } catch { return null; }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      // Old snapshots have no target binding; deliberately do not hydrate them.
      if (req.result.objectStoreNames.contains('kv')) req.result.deleteObjectStore('kv');
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>, valid = () => true): Promise<T | undefined> {
  const db = await openDb();
  try {
    if (!valid()) return undefined;
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      // A request success is not proof that the transaction committed.
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** Bounded traversal excludes keys/URLs/class instances and oversized results. */
export function snapshotQuery(query: Query): { snapshot: Snapshot; bytes: number } | null {
  if (query.state.status !== 'success' || query.state.data === undefined || query.meta?.persist === false) return null;
  // Progressive aggregate replies remain usable in memory, not as complete
  // offline inventories (including successful-but-partial fixture discovery).
  if (typeof query.state.data === 'object' && query.state.data !== null &&
    'incomplete' in query.state.data && query.state.data.incomplete === true) return null;
  if (SKIP_KEY.test(query.queryHash)) return null;
  let nodes = 0; let bytes = 0;
  const visit = (value: unknown, depth = 0): boolean => {
    if (++nodes > 12000 || depth > 12 || bytes > MAX_QUERY_BYTES) return false;
    if (typeof value === 'string') { bytes += value.length * 2; return !value.startsWith('blob:') && bytes <= MAX_QUERY_BYTES; }
    if (value == null) { bytes += 4; return true; }
    if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') { bytes += 16; return true; }
    if (typeof value !== 'object') return false;
    if (value instanceof Date) { bytes += 8; return true; }
    if (ArrayBuffer.isView(value)) { bytes += value.byteLength; return bytes <= MAX_QUERY_BYTES; }
    if (Array.isArray(value)) return value.every(v => visit(v, depth + 1));
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      // Personal labels belong to mounted authorized readers, not offline
      // snapshots (including composite rosters/duties that embed profiles).
      if (['display_name', 'displayName'].includes(key) && typeof (value as Record<string, unknown>)[key] === 'string') return false;
      bytes += key.length * 2;
      if (!visit((value as Record<string, unknown>)[key], depth + 1)) return false;
    }
    return true;
  };
  if (!visit(query.queryKey) || !visit(query.state.data)) return null;
  return { bytes: bytes + 512, snapshot: {
    queryHash: query.queryHash, queryKey: query.queryKey, dehydratedAt: Date.now(),
    state: { ...query.state, fetchStatus: 'idle' },
  } };
}

/** Restore in small jobs; a timeout/account switch cancels late hydration. */
export async function restoreIcpQueryCache(client: QueryClient, isIcp: boolean, maxWaitMs = 400, scope: ScopeReader = currentPrincipal): Promise<void> {
  if (!isIcp || typeof indexedDB === 'undefined') return;
  const owner = scope(); if (!owner) return;
  const epoch = generation; let cancelled = false;
  const valid = () => !cancelled && generation === epoch && scope() === owner;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const records = await transaction<Stored[]>('readonly', s => s.getAll(), valid);
        if (!records || !valid()) return;
        let total = 0; let count = 0;
        for (const row of records.sort((a, b) =>
          savedPagePriority(b.snapshot.queryKey) - savedPagePriority(a.snapshot.queryKey) || b.savedAt - a.savedAt)) {
          if (!valid()) return;
          if (row.scope !== owner || Date.now() - row.savedAt > MAX_AGE_MS || row.bytes > MAX_QUERY_BYTES + 512) continue;
          if (++count > MAX_QUERIES || (total += row.bytes) > MAX_TOTAL_BYTES) break;
          hydrate(client, { queries: [row.snapshot], mutations: [] });
          if (count % 4 === 0) await new Promise<void>(r => setTimeout(r, 0));
        }
      })(),
      new Promise<void>(resolve => { timeout = setTimeout(() => { cancelled = true; resolve(); }, maxWaitMs); }),
    ]);
  } catch { /* best-effort cache */ }
  finally { cancelled = true; clearTimeout(timeout); }
}

/** Single managed subscriber; one bounded changed-query write per idle job. */
export function startIcpQueryCachePersist(client: QueryClient, isIcp: boolean, scope: ScopeReader = currentPrincipal): () => void {
  active.get(client)?.();
  if (!isIcp || typeof indexedDB === 'undefined') return () => {};
  void import('@/live/deviceMediaCache').then(m => m.pruneDeviceCachedPhotos()).catch(() => {});
  let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let idleHandle: number | undefined; let working = false;
  let owner = scope(); let epoch = generation;
  let initializedOwner: string | null = null;
  const pending = new Map<string, Query | null>();
  const sizes = new Map<string, number>();
  const valid = () => !stopped && epoch === generation && !!owner && scope() === owner;
  const idleApi = globalThis as typeof globalThis & {
    requestIdleCallback?: (fn: () => void, opts: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  const process = async () => {
    idleHandle = undefined;
    if (working || !valid()) { pending.clear(); return; }
    const next = pending.entries().next(); if (next.done) return;
    const [hash, query] = next.value; pending.delete(hash); working = true;
    const writeOwner = owner;
    const writeEpoch = epoch;
    const writeValid = () => valid() && owner === writeOwner && generation === writeEpoch;
    try {
      if (initializedOwner !== writeOwner) {
        const records = await transaction<Stored[]>('readonly', s => s.getAll(), writeValid);
        if (!writeValid()) return;
        for (const row of records ?? []) {
          if (row.scope === writeOwner && Date.now() - row.savedAt <= MAX_AGE_MS) sizes.set(row.snapshot.queryHash, row.bytes);
          else await transaction('readwrite', s => s.delete(row.snapshot.queryHash), writeValid);
        }
        initializedOwner = writeOwner;
      }
      const value = query ? snapshotQuery(query) : null;
      if (!value) {
        sizes.delete(hash);
        await transaction('readwrite', s => s.delete(hash), writeValid);
      } else {
        sizes.delete(hash); sizes.set(hash, value.bytes);
        let total = [...sizes.values()].reduce((a, b) => a + b, 0);
        while (sizes.size > MAX_QUERIES || total > MAX_TOTAL_BYTES) {
          const oldest = sizes.entries().next(); if (oldest.done) break;
          sizes.delete(oldest.value[0]); total -= oldest.value[1];
          await transaction('readwrite', s => s.delete(oldest.value[0]), writeValid);
        }
        const row: Stored = { scope: writeOwner ?? '', savedAt: Date.now(), ...value };
        await transaction('readwrite', s => s.put(row, hash), writeValid);
      }
    } catch { /* skip failed cache write; never impede the live result */ }
    finally { working = false; schedule(); }
  };
  const schedule = () => {
    if (stopped || working || timer !== undefined || idleHandle !== undefined || !pending.size) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (idleApi.requestIdleCallback) idleHandle = idleApi.requestIdleCallback(() => { void process(); }, { timeout: 2000 });
      else { timer = setTimeout(() => { timer = undefined; void process(); }, 0); }
    }, 25);
  };
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (!valid()) { owner = scope(); pending.clear(); sizes.clear(); }
    if (!owner || stopped || epoch !== generation) return;
    if (event.type === 'removed') pending.set(event.query.queryHash, null);
    else if (event.type === 'updated' && event.action.type === 'success') pending.set(event.query.queryHash, event.query);
    else return;
    schedule();
  });
  const stop = () => {
    stopped = true; unsubscribe(); pending.clear();
    if (timer !== undefined) clearTimeout(timer);
    if (idleHandle !== undefined) idleApi.cancelIdleCallback?.(idleHandle);
    if (active.get(client) === stop) active.delete(client);
    resetters.delete(client);
  };
  active.set(client, stop);
  resetters.set(client, () => {
    pending.clear(); sizes.clear(); initializedOwner = null; owner = null; epoch = generation;
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (idleHandle !== undefined) { idleApi.cancelIdleCallback?.(idleHandle); idleHandle = undefined; }
  });
  // Seed once, bounded; subsequent writes only inspect changed queries.
  for (const q of client.getQueryCache().getAll().slice(-MAX_QUERIES)) pending.set(q.queryHash, q);
  schedule();
  return stop;
}

export async function clearPersistedIcpQueryCache(): Promise<void> {
  generation++;
  // A new sign-in may happen without remounting App. Reset pending work while
  // retaining its subscriber; in-flight old writes fail their captured epoch.
  for (const reset of resetters.values()) reset();
  if (typeof indexedDB === 'undefined') return;
  try { await transaction('readwrite', s => s.clear()); } catch { /* best effort */ }
}