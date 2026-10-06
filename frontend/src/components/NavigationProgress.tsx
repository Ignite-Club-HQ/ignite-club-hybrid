import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useIsFetching } from "@tanstack/react-query";

/**
 * Thin top progress bar giving instant feedback when the user taps a link or
 * navigating button. Stays visible until the new page has changed and its
 * initial data requests have settled (max 10s).
 */
export function NavigationProgress() {
  const location = useLocation();
  const fetching = useIsFetching();
  const [active, setActive] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const startPath = useRef<string>("");
  const timer = useRef<number>();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(
        'a[href], [role="link"], button, [role="button"]',
      );
      if (!el || el.closest("[data-no-nav-progress]")) return;
      startPath.current = window.location.pathname + window.location.search;
      setNavigated(false);
      setActive(true);
      window.clearTimeout(timer.current);
      // If nothing navigates shortly, it was an in-page button — hide.
      timer.current = window.setTimeout(() => {
        if (window.location.pathname + window.location.search === startPath.current) setActive(false);
      }, 600);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const now = location.pathname + location.search;
    if (now !== startPath.current) {
      setNavigated(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setActive(false), 10000);
    }
  }, [location, active]);

  useEffect(() => {
    if (!active || !navigated || fetching > 0) return;
    const t = window.setTimeout(() => setActive(false), 150);
    return () => window.clearTimeout(t);
  }, [active, navigated, fetching]);

  if (!active) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px] overflow-hidden bg-primary/20"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="nav-progress-bar h-full w-1/3 bg-primary" />
    </div>
  );
}
