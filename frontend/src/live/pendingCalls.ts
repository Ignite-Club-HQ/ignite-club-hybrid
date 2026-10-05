/**
 * Global counter of in-flight ICP canister UPDATE calls.
 *
 * Canister updates take ~2–5s on mainnet, and most buttons show no pending
 * state of their own in ICP mode — the tap appears dead. `IcpPendingBar`
 * subscribes here and shows a top progress bar while any update call is in
 * flight, giving every button universal click feedback without touching
 * each call site.
 *
 * Only update (non-query) calls are tracked: query polling (chat refresh
 * etc.) must never flash the bar. This module is intentionally pure (no ICP
 * SDK imports) so entry-chunk files may import it statically.
 */

type PendingListener = (pending: number) => void;

let pendingCount = 0;
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

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(pendingCount);
    } catch {
      /* noop */
    }
  }
}

/** Tracks one canister call promise; safe on non-promise (one-way) results. */
export function trackIcpUpdateCall<T>(result: T): T {
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
