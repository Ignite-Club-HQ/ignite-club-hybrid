import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import {
  PITCH_STATE_KEY,
  PITCH_STATE_KEY_BASE,
  PITCH_BOARD_OPEN_KEY,
  TIMER_STORAGE_KEY,
} from "./types";

// Lazy-load the heavy monitor so anonymous/idle users never download or mount it.
const GlobalSubMonitor = lazyWithRetry(() => import("./GlobalSubMonitor"));

const POLL_INTERVAL_MS = 8000;

/**
 * Cheap predicate run before mounting the full monitor.
 * Looks for any pitch board / timer state in localStorage.
 * No Supabase calls, no React state churn.
 */
const hasAnyGameState = (): boolean => {
  try {
    if (localStorage.getItem(TIMER_STORAGE_KEY)) return true;
    if (localStorage.getItem(PITCH_STATE_KEY)) return true;
    if (localStorage.getItem(PITCH_BOARD_OPEN_KEY) === "true") return true;
    // Team-scoped pitch state keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PITCH_STATE_KEY_BASE)) return true;
    }
  } catch {
    // localStorage may be blocked in some contexts
    return false;
  }
  return false;
};

/**
 * GlobalSubMonitorGate
 * --------------------
 * Performance gate around GlobalSubMonitor. The monitor only mounts when:
 *   1. A user is authenticated, AND
 *   2. There is some pitch/timer state in localStorage indicating a game.
 *
 * This avoids downloading + initializing the 1100-line monitor (with its
 * intervals, visibility/storage listeners, and Supabase round-trips) for
 * anonymous visitors on /auth and authenticated users with no active game.
 *
 * The monitor's own internal `hasActiveGame()` still gates network sync —
 * this wrapper is purely about not paying the mount cost in the common idle case.
 */
export default function GlobalSubMonitorGate() {
  const { user } = useAuth();
  const [hasGame, setHasGame] = useState<boolean>(() => hasAnyGameState());

  // Poll cheaply for game state changes. We can't only rely on storage events
  // because same-tab writes don't fire StorageEvent on most browsers.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const next = hasAnyGameState();
      setHasGame((prev) => (prev === next ? prev : next));
    };

    check();

    const intervalId = window.setInterval(check, POLL_INTERVAL_MS);

    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === TIMER_STORAGE_KEY ||
        e.key === PITCH_BOARD_OPEN_KEY ||
        (e.key && e.key.startsWith(PITCH_STATE_KEY_BASE))
      ) {
        check();
      }
    };
    const handleSameTab = () => check();

    window.addEventListener("storage", handleStorage);
    window.addEventListener("game-state-changed", handleSameTab);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("game-state-changed", handleSameTab);
    };
  }, [user]);

  if (!user || !hasGame) return null;

  return (
    <Suspense fallback={null}>
      <GlobalSubMonitor />
    </Suspense>
  );
}
