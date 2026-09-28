/**
 * In-memory LRU cache of measured row heights, keyed by message id.
 *
 * Virtuoso re-measures rows every time they remount after being scrolled out
 * of the overscan window, then it falls back to `defaultItemHeight` for any
 * row it has never measured in this session. On long histories that means a
 * fast upward fling repeatedly trades the current `estimateChatRowHeight()`
 * value for the eventual real measurement, and Virtuoso patches `paddingTop`
 * each time — the residual visible jolt.
 *
 * Caching the real measured height across remounts lets the estimator return
 * the exact previous height the second time a row is visited, eliminating
 * the post-measure correction entirely for any row the user has already seen.
 *
 * The cache is process-local and bounded (~2000 entries) so it cannot grow
 * unbounded across long sessions. Entries are evicted in insertion order
 * (Map iteration order). 2000 rows ≈ ~6 weeks of an active team chat.
 *
 * The cache is mirrored to sessionStorage so a full page refresh (common on
 * native WebView resume) does not lose the measured heights — Virtuoso can
 * render the next session's rows at exact heights from the very first paint.
 */

const MAX_ENTRIES = 2000;
// v6: flush entries poisoned by the reverted off-screen pre-measure portal
// (heights measured outside the live Virtuoso item container were wrong).
const STORAGE_KEY = "ignite_chat:rowHeightCache:v6";
// Throttle persistence — measurement bursts (e.g. initial mount) can call
// setCachedRowHeight dozens of times per frame; avoid serialising on each.
const PERSIST_DEBOUNCE_MS = 400;

const cache = new Map<string, number>();
const sigs = new Map<string, string>();
let dirty = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let restored = false;

function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function restoreFromStorage() {
  if (restored) return;
  restored = true;
  const ss = safeSessionStorage();
  if (!ss) return;
  try {
    const raw = ss.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [id, h, sig] = entry as [unknown, unknown, unknown];
      if (typeof id !== "string" || !id) continue;
      if (typeof h !== "number" || !Number.isFinite(h) || h <= 0) continue;
      cache.set(id, Math.round(h));
      if (typeof sig === "string") sigs.set(id, sig);
      if (cache.size > MAX_ENTRIES) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) {
          cache.delete(firstKey);
          sigs.delete(firstKey);
        }
      }
    }
  } catch {
    // Corrupt payload — drop it silently.
    try { ss.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

function schedulePersist() {
  dirty = true;
  if (persistTimer !== null) return;
  const ss = safeSessionStorage();
  if (!ss) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      const payload = JSON.stringify(Array.from(cache.entries()).map(([id, height]) => [id, height, sigs.get(id) ?? null]));
      ss.setItem(STORAGE_KEY, payload);
    } catch {
      // Quota / serialisation failure — ignore; in-memory cache is still good.
    }
  }, PERSIST_DEBOUNCE_MS);
}

// Restore eagerly at module load so the very first estimateChatRowHeight()
// call after a refresh already sees prior heights.
restoreFromStorage();

export function getCachedRowHeight(
  id: string | null | undefined,
  signature?: string,
): number | undefined {
  if (!id) return undefined;
  const v = cache.get(id);
  if (v === undefined) return undefined;
  // Signature mismatch → message content/context changed since last measurement
  // (edit, reactions changed, link-preview hydrated). Treat as a miss so
  // estimateChatRowHeight falls back to a fresh estimate instead of returning
  // a stale measured height.
  if (signature !== undefined) {
    const prevSig = sigs.get(id);
    if (prevSig === undefined || prevSig !== signature) {
      cache.delete(id);
      sigs.delete(id);
      schedulePersist();
      return undefined;
    }
  }
  // Touch for LRU: re-insert moves the entry to the most-recent position in
  // Map iteration order so the next eviction targets a stale row instead.
  cache.delete(id);
  cache.set(id, v);
  return v;
}

export function setCachedRowHeight(
  id: string | null | undefined,
  height: number,
  signature?: string,
) {
  if (!id) return;
  if (!Number.isFinite(height) || height <= 0) return;
  // Snap to integer — Virtuoso's measurement comes from `offsetHeight` which
  // is already integer, but guard against accidental floats.
  const next = Math.round(height);
  if (signature !== undefined) sigs.set(id, signature);
  const prev = cache.get(id);
  if (prev === next) {
    // Touch for LRU without churning insertion when the value is unchanged.
    cache.delete(id);
    cache.set(id, next);
    return;
  }
  cache.set(id, next);
  if (cache.size > MAX_ENTRIES) {
    // Evict the oldest entry (first in insertion order).
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
      sigs.delete(firstKey);
    }
  }
  schedulePersist();
}

export function invalidateCachedRowHeight(id: string | null | undefined) {
  if (!id) return;
  const had = cache.delete(id);
  sigs.delete(id);
  if (had) schedulePersist();
}

export function clearChatRowHeightCache() {
  cache.clear();
  sigs.clear();
  const ss = safeSessionStorage();
  if (ss) {
    try { ss.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
  dirty = false;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

/** Test/debug accessor — current cache size. */
export function getChatRowHeightCacheSize() {
  return cache.size;
}

// Flush any pending writes when the tab is hidden / unloaded so a refresh
// triggered immediately after a measurement burst doesn't lose entries.
if (typeof window !== "undefined") {
  const flush = () => {
    if (!dirty) return;
    const ss = safeSessionStorage();
    if (!ss) return;
    try {
      ss.setItem(STORAGE_KEY, JSON.stringify(Array.from(cache.entries()).map(([id, height]) => [id, height, sigs.get(id) ?? null])));
      dirty = false;
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
    } catch { /* ignore */ }
  };
  window.addEventListener("pagehide", flush);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
