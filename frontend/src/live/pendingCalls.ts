/**
 * Global counter of in-flight ICP canister calls that the user is waiting on.
 *
 * ICP mode is slower than Supabase across the board: canister updates take
 * ~2–5s, and reads after a page change can take a second or more. Most
 * buttons show no pending state of their own, so taps appear dead.
 * `IcpPendingBar` subscribes here and shows a top progress bar while any
 * tracked call is in flight, giving universal feedback without touching
 * each call site.
 *
 * Two kinds of calls are tracked:
 *   1. UPDATE calls — always tracked (a write is always user-initiated).
 *   2. QUERY calls — tracked only when they start within a short window
 *      after a navigation (`noteIcpNavigation`), i.e. the reads that make a
 *      freshly opened page load. Background polling (chat refresh etc.)
 *      starts outside that window and never flashes the bar.
 *
 * This module is intentionally pure (no ICP SDK imports) so entry-chunk
 * files may import it statically.
 */

type PendingListener = (pending: number) => void;

/** How long after a navigation its data reads still count as foreground. */
const NAV_FOREGROUND_WINDOW_MS = 4_000;

let pendingCount = 0;
let navForegroundUntil = 0;
const listeners = new Set<PendingListener>();

export function getPendingIcpUpdateCalls(): number {
  return pendingCount;
}

export function subscribePendingIcpUpdateCalls(listener: PendingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Call on every route change (and app mount). Canister reads that start
 * within the following window are treated as page-load work and drive the
 * pending bar; reads after the window (polling, prefetch) stay silent.
 */
export function noteIcpNavigation(): void {
  navForegroundUntil = Date.now() + NAV_FOREGROUND_WINDOW_MS;
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(pendingCount);
    } catch {
      /* noop */
    }
  }
}

function track<T>(result: T): T {
  if (!result || typeof (result as Promise<unknown>).then !== "function") {
    return result;
  }
  pendingCount += 1;
  notify();
  const promise = result as Promise<unknown>;
  const done = () => {
    pendingCount = Math.max(0, pendingCount - 1);
    notify();
  };
  promise.then(done, done);
  return result;
}

/** Tracks one canister UPDATE call promise; safe on non-promise results. */
export function trackIcpUpdateCall<T>(result: T): T {
  return track(result);
}

/**
 * Tracks one canister QUERY call promise — but only when it started inside
 * the post-navigation foreground window, so periodic polling never shows
 * the bar.
 */
export function trackIcpQueryCall<T>(result: T): T {
  if (Date.now() >= navForegroundUntil) return result;
  return track(result);
}
