import { memo, Suspense, useEffect, useMemo, useReducer, useRef, type ComponentType, type ReactNode } from "react";
import {
  Outlet,
  Route,
  Routes,
  UNSAFE_NavigationContext as NavigationContext,
  useLocation,
  type Location,
} from "react-router-dom";
import { useContext } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { TabPagePlaceholder } from "./TabPagePlaceholder";
import { KeptPageActivity } from "./KeptPageActivity";

/**
 * Keeps the bottom-tab pages (Home, Messages, Schedule, Media) mounted once
 * opened, hiding inactive ones instead of unmounting them. Switching tabs then
 * shows the already-rendered page instantly instead of re-mounting a large page
 * and waiting on on-chain reads before anything appears.
 *
 * Hidden pages see a frozen copy of their own last location and cannot
 * navigate, so a background page can never change the visible URL.
 */
export const KEPT_TAB_PATHS = ["/", "/messages", "/events", "/media"] as const;
type TabPath = (typeof KEPT_TAB_PATHS)[number];

const pages: Record<TabPath, ComponentType> = {
  "/": lazyWithRetry(() => import("@/pages/HomePage")),
  "/messages": lazyWithRetry(() => import("@/pages/MessagesPage")),
  "/events": lazyWithRetry(() => import("@/pages/EventsPage")),
  "/media": lazyWithRetry(() => import("@/pages/MediaPage")),
};

export function isKeptTabPath(pathname: string): pathname is TabPath {
  return (KEPT_TAB_PATHS as readonly string[]).includes(pathname);
}

function FrozenNavigation({ frozen, children }: { frozen: boolean; children: ReactNode }) {
  const ctx = useContext(NavigationContext);
  const value = useMemo(() => {
    if (!frozen) return ctx;
    const noop = () => undefined;
    return { ...ctx, navigator: { ...ctx.navigator, push: noop, replace: noop, go: noop } };
  }, [ctx, frozen]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

const KeptTab = memo(function KeptTab({ path, location, active }: { path: TabPath; location: Location; active: boolean }) {
  const Page = pages[path];
  return (
    <div className={active ? "contents" : "hidden"} aria-hidden={!active || undefined} data-kept-tab={path}>
      <FrozenNavigation frozen={!active}>
        <KeptPageActivity.Provider value={active}>
        <Suspense
          fallback={active ? <TabPagePlaceholder /> : null}
        >
          <Routes location={location}>
            <Route path={path} element={<Page />} />
          </Routes>
        </Suspense>
        </KeptPageActivity.Provider>
      </FrozenNavigation>
    </div>
  );
});

const warmLocation = (path: TabPath): Location => ({ pathname: path, search: "", hash: "", state: null, key: `warm-${path}` });

export function KeptTabsOutlet({ ownerId, prewarm }: { ownerId: string; prewarm: boolean }) {
  const location = useLocation();
  const active = isKeptTabPath(location.pathname) ? location.pathname : null;
  const kept = useRef(new Map<TabPath, Location>());
  const owner = useRef(ownerId);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  if (owner.current !== ownerId) {
    kept.current.clear();
    owner.current = ownerId;
  }
  if (active) kept.current.set(active, location);

  // Prepare the remaining tabs in the background, one at a time, once the
  // first page has had time to settle.
  useEffect(() => {
    if (!prewarm) return;
    const order: TabPath[] = ["/messages", "/events", "/media", "/"];
    const timers: number[] = [];
    order.forEach((path, i) => {
      timers.push(window.setTimeout(() => {
        if (owner.current !== ownerId || kept.current.has(path)) return;
        kept.current.set(path, warmLocation(path));
        bump();
      }, 4000 + i * 2500));
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [prewarm, ownerId]);

  return (
    <>
      {!active && <Outlet />}
      {[...kept.current].map(([path, loc]) => (
        <KeptTab key={`${ownerId}:${path}`} path={path} location={loc} active={path === active} />
      ))}
    </>
  );
}
