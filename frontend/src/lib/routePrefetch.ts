// Route chunk prefetcher. Triggered on bottom-tab `pointerdown` so the JS
// chunk for the destination route starts downloading ~50–150ms before the
// click event fires. Purely additive; on failure the normal lazy import in
// App.tsx runs as usual.

type Loader = () => Promise<unknown>;

const loaders: Record<string, Loader> = {
  "/": () => import("@/pages/HomePage"),
  "/messages": () => import("@/pages/MessagesPage"),
  "/events": () => import("@/pages/EventsPage"),
  "/media": () => import("@/pages/MediaPage"),
  "/clubs/upgrade": () => import("@/pages/ClubUpgradePage"),
};

const started = new Map<string, Promise<unknown>>();

export function prefetchRoute(path: string) {
  if (/^\/clubs\/[^/]+\/upgrade$/.test(path)) path = "/clubs/upgrade";
  const loader = loaders[path];
  if (!loader) return Promise.resolve();
  const existing = started.get(path);
  if (existing) return existing;
  // Fire-and-forget; ignore failures (network offline, etc.) — the normal
  // lazy import will retry when the user actually navigates.
  const pending = loader().catch(() => {
    started.delete(path);
  });
  started.set(path, pending);
  return pending;
}

/**
 * Warm all bottom-tab route chunks during browser idle time after boot.
 * Called once from the app shell so that by the time the user taps
 * Messages/Schedule/Media the JS chunk is already parsed — this removes
 * the route chunk fetch from the tap's critical path where possible.
 *
 * Sequenced (not parallel) so the initial paint isn't starved of bandwidth
 * on slow networks. Messages first because it's the most-visited tab and
 * the most common push-notification landing route.
 */
let warmed = false;
export function warmMainRoutes() {
  if (warmed) return;
  warmed = true;
  const order = ["/messages", "/events", "/", "/media"];
  const runNext = (i: number) => {
    if (i >= order.length) return;
    // Wait only in the background warmer, never in navigation. Slow imports
    // must not overlap all four chunks and compete with the visible page.
    void prefetchRoute(order[i]).finally(() => {
      window.setTimeout(() => runNext(i + 1), 200);
    });
  };
  const w = window as any;
  const schedule = (cb: () => void) => {
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(cb, { timeout: 1000 });
    } else {
      window.setTimeout(cb, 500);
    }
  };
  schedule(() => runNext(0));
}

