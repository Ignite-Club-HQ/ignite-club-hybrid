import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";

/**
 * Web-only reconnect / resume recovery.
 *
 * Native apps get the equivalent (and broader) behaviour from
 * `reactQueryNativeAdapter.ts`. On the web, iOS Safari and iframed
 * previews frequently miss the `offline → online` transition, and
 * `refetchOnReconnect: "always"` only refires queries whose status is
 * `success` — queries that errored or got stuck mid-flight during the
 * drop stay dead until something explicitly kicks them.
 *
 * Two distinct recovery modes, deliberately kept separate:
 *
 *   - RECONNECT (offline→online, `window.online`, onlineManager flipping
 *     back on): refetch every actively-observed query, because data
 *     fetched during the outage may be wrong or missing. Dripped in
 *     batches so a heavy page (Inbox mounts ~25-30 queries) can't
 *     saturate the browser's ~6-connection-per-origin pool.
 *
 *   - RESUME (tab becomes visible again while already online): revive
 *     ONLY queries that are actually broken — error / paused /
 *     idle-non-success. A resume is not a reconnect; healthy queries
 *     still hold valid data. Blanket-refetching on every visibility
 *     change is what starved the connection pool and left pages stuck
 *     on skeletons.
 */
let installed = false;

export function installWebReconnectInvalidator(queryClient: QueryClient) {
  if (installed) return;
  if (Capacitor.isNativePlatform()) return; // native adapter covers this
  if (typeof window === "undefined") return;

  installed = true;

  let lastRunAt = 0;
  const THROTTLE_MS = 2000;
  const BATCH = 6;
  const BATCH_DELAY_MS = 120;

  /** Revive only genuinely broken queries. Safe to run on any resume. */
  const reviveStuck = (): number => {
    const cache = queryClient.getQueryCache();
    const stuck = cache.getAll().filter((q) => {
      const s = q.state;
      return (
        s.status === "error" ||
        (s.fetchStatus === "idle" && s.status !== "success") ||
        s.fetchStatus === "paused"
      );
    });
    stuck.forEach((q) => {
      try {
        queryClient.invalidateQueries({ queryKey: q.queryKey, exact: true });
      } catch { /* ignore */ }
    });
    return stuck.length;
  };

  /** Drip-refetch every observed query. Reconnect only — never on resume. */
  const refetchActiveBatched = () => {
    try {
      const active = queryClient.getQueryCache().findAll({ type: "active" });
      for (let i = 0; i < active.length; i += BATCH) {
        const slice = active.slice(i, i + BATCH);
        const delay = (i / BATCH) * BATCH_DELAY_MS;
        setTimeout(() => {
          slice.forEach((q) => {
            try {
              queryClient.refetchQueries({ queryKey: q.queryKey, exact: true });
            } catch { /* ignore */ }
          });
        }, delay);
      }
    } catch { /* ignore */ }
  };

  const kick = (reason: string, opts?: { refetchActive?: boolean }) => {
    const now = Date.now();
    if (now - lastRunAt < THROTTLE_MS) return;
    lastRunAt = now;
    try {
      const refetchActive = opts?.refetchActive === true;
      if (refetchActive) refetchActiveBatched();
      const stuckCount = reviveStuck();
      if (import.meta.env.DEV) {
        console.log(
          `[WebReconnect] ${refetchActive ? "refetched active + " : ""}${stuckCount} stuck (${reason})`,
        );
      }
    } catch {
      /* ignore */
    }
  };

  // Track online state ourselves so we only treat a genuine
  // offline→online edge as a reconnect.
  let wasOnline = onlineManager.isOnline();

  const unsubscribe = onlineManager.subscribe(() => {
    const isOnline = onlineManager.isOnline();
    const transitioned = isOnline && !wasOnline;
    wasOnline = isOnline;
    if (transitioned) kick("online-manager", { refetchActive: true });
  });

  const onBrowserOnline = () => {
    wasOnline = true;
    kick("window-online", { refetchActive: true });
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) {
      // Resume, not reconnect — stuck queries only.
      kick("visibility");
    }
  };

  window.addEventListener("online", onBrowserOnline);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    unsubscribe();
    window.removeEventListener("online", onBrowserOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    installed = false;
  };
}
