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
};

const started = new Set<string>();

export function prefetchRoute(path: string) {
  const loader = loaders[path];
  if (!loader || started.has(path)) return;
  started.add(path);
  // Fire-and-forget; ignore failures (network offline, etc.) — the normal
  // lazy import will retry when the user actually navigates.
  loader().catch(() => {
    started.delete(path);
  });
}

/**
 * Warm all bottom-tab route chunks during browser idle time after boot.
 * Called once from the app shell so that by the time the user taps
 * Messages/Schedule/Media the JS chunk is already parsed — this removes
 * ~800–1500ms from cold `/messages` opens on Android where the route
 * chunk fetch previously happened on the critical path.
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
    prefetchRoute(order[i]);
    // Chain the next one after a short delay so we don't saturate.
    window.setTimeout(() => runNext(i + 1), 400);
  };
  const w = window as any;
  const schedule = (cb: () => void) => {
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(cb, { timeout: 4000 });
    } else {
      window.setTimeout(cb, 2500);
    }
  };
  schedule(() => runNext(0));
}

