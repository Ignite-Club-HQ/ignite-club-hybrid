/**
 * Coalescing, dripped invalidation queue for chat/inbox query keys.
 *
 * Why this exists
 * ---------------
 * Two paths used to fire large invalidation bursts:
 *   - the inbox mount/visibility refresh (6 keys, each an N+1 preview cascade);
 *   - foreground push receipt (up to 8 keys, once PER notification — a burst
 *     of pushes multiplied that).
 *
 * On Android WebView the ~6-connection-per-origin pool saturates and the main
 * thread stalls: the list renders but taps do nothing until a force-quit.
 *
 * This queue keeps the "instant update" behaviour while bounding the cost:
 *   1. Keys are deduped inside a short collect window (COALESCE_MS), so N
 *      pushes arriving together produce ONE flush.
 *   2. The flush drips keys in batches of MAX_CONCURRENT, spaced BATCH_GAP_MS
 *      apart, so we never exceed the connection budget.
 *   3. Repeat flushes are throttled by MIN_FLUSH_GAP_MS.
 *
 * Kill switch: window.__disableChatInvalidationQueue === true falls back to
 * immediate invalidation (original behaviour).
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";

const COALESCE_MS = 150;
const BATCH_GAP_MS = 120;
const MAX_CONCURRENT = 3;
const MIN_FLUSH_GAP_MS = 700;

let pending = new Map<string, QueryKey>();
let collectTimer: ReturnType<typeof setTimeout> | null = null;
let lastFlushAt = 0;
let client: QueryClient | null = null;

function killSwitchEngaged(): boolean {
  try {
    return typeof window !== "undefined" && (window as any).__disableChatInvalidationQueue === true;
  } catch {
    return false;
  }
}

function flush() {
  collectTimer = null;
  const qc = client;
  if (!qc) return;
  const keys = Array.from(pending.values());
  pending = new Map();
  if (keys.length === 0) return;
  lastFlushAt = Date.now();

  let index = 0;
  const runBatch = () => {
    const batch = keys.slice(index, index + MAX_CONCURRENT);
    index += MAX_CONCURRENT;
    for (const key of batch) {
      try {
        qc.invalidateQueries({ queryKey: key });
      } catch {
        /* noop */
      }
    }
    if (index < keys.length) setTimeout(runBatch, BATCH_GAP_MS);
  };
  runBatch();
}

/**
 * Queue one or more query keys for coalesced, dripped invalidation.
 * Safe to call on every push receipt / mount — bursts collapse into one flush.
 */
export function queueChatInvalidation(queryClient: QueryClient, keys: QueryKey[]): void {
  if (killSwitchEngaged()) {
    for (const key of keys) {
      try {
        queryClient.invalidateQueries({ queryKey: key });
      } catch {
        /* noop */
      }
    }
    return;
  }

  client = queryClient;
  for (const key of keys) {
    if (!key || (Array.isArray(key) && key.some((part) => part == null))) continue;
    pending.set(JSON.stringify(key), key);
  }
  if (collectTimer) return;

  const sinceLast = Date.now() - lastFlushAt;
  const delay = sinceLast >= MIN_FLUSH_GAP_MS ? COALESCE_MS : Math.max(COALESCE_MS, MIN_FLUSH_GAP_MS - sinceLast);
  collectTimer = setTimeout(flush, delay);
}

/** Test/teardown helper. */
export function __resetChatInvalidationQueue(): void {
  if (collectTimer) clearTimeout(collectTimer);
  collectTimer = null;
  pending = new Map();
  lastFlushAt = 0;
  client = null;
}
