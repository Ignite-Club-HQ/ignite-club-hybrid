/** Only disposable read copies belong here: never auth, keys, drafts or receipts. */
export const LOCAL_READ_CACHE_BYTES = 2 * 1024 * 1024;
export const ICP_READ_CACHE_BYTES = 2 * 1024 * 1024;
export const VIEWED_PHOTO_CACHE_BYTES = 20 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXACT_KEYS = new Set([
  'ignite_query_cache_v1', 'ignite_photos_cache', 'ignite_folders_cache',
  'ignite_clubs_cache', 'ignite_teams_cache', 'messages-page-cache-v2',
  'signed-url-cache-v1', 'ignite_chat_thread_labels_v1',
]);
const PREFIXES = ['ignite_message_cache_', 'ignite_events_list_', 'ignite_event_detail_',
  'ignite_event_rsvps_', 'ignite_my_teams_carousel_v2_', 'ignite_next_up_events_'];
export function isDisposableReadCache(key: string): boolean {
  return EXACT_KEYS.has(key) || PREFIXES.some(prefix => key.startsWith(prefix));
}
export function storedTextBytes(key: string, value: string): number {
  // UTF-16 accounting is conservative for text, including the storage key.
  return (key.length + value.length) * 2;
}
type Entry = { bytes: number; time: number };
let inventory: Map<string, Entry> | null = null;
function entries(): Map<string, Entry> {
  if (inventory) return inventory;
  inventory = new Map();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key || !isDisposableReadCache(key)) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    try {
      const parsed = JSON.parse(value);
      const time = parsed.timestamp ?? parsed.savedAt ?? Date.now();
      const bytes = storedTextBytes(key, value);
      const limit = key === 'ignite_query_cache_v1' ? LOCAL_READ_CACHE_BYTES : MAX_ENTRY_BYTES;
      if (!Number.isFinite(time) || Date.now() - time > TTL_MS || bytes > limit) {
        localStorage.removeItem(key); continue;
      }
      inventory.set(key, { bytes, time });
    } catch { localStorage.removeItem(key); }
  }
  return inventory;
}
function trim(rows: Map<string, Entry>, incomingBytes = 0): void {
  let total = incomingBytes;
  for (const [key, entry] of rows) {
    if (localStorage.getItem(key) === null || Date.now() - entry.time > TTL_MS) {
      localStorage.removeItem(key); rows.delete(key);
    } else total += entry.bytes;
  }
  for (const [key, entry] of [...rows].sort((a, b) => a[1].time - b[1].time)) {
    if (total <= LOCAL_READ_CACHE_BYTES) break;
    localStorage.removeItem(key); rows.delete(key); total -= entry.bytes;
  }
}
/** Call off the interaction frame; caches failing to save never block live data. */
export function writeBoundedReadCache(key: string, value: string): boolean {
  try {
    if (!isDisposableReadCache(key) || typeof localStorage === 'undefined') return false;
    const rows = entries();
    const bytes = storedTextBytes(key, value);
    const limit = key === 'ignite_query_cache_v1' ? LOCAL_READ_CACHE_BYTES : MAX_ENTRY_BYTES;
    rows.delete(key);
    if (bytes > limit) { localStorage.removeItem(key); trim(rows); return false; }
    trim(rows, bytes);
    localStorage.setItem(key, value);
    rows.set(key, { bytes, time: Date.now() });
    return true;
  } catch { return false; }
}
export function pruneDeviceReadCaches(): void {
  try { inventory = null; trim(entries()); } catch { /* unavailable storage */ }
}
export function clearDeviceReadCacheStorage(): void {
  inventory = null;
  if (typeof localStorage === 'undefined') return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && isDisposableReadCache(key)) localStorage.removeItem(key);
  }
}