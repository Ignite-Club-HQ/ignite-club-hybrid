import { useEffect, useRef } from "react";

/**
 * Acquire a screen wake lock while `active` is true so the device screen
 * stays on during a live game. No-op on browsers without the API
 * (Safari < 16.4, older Android WebViews) — we just degrade silently.
 *
 * Re-acquires automatically when the tab becomes visible again, since
 * browsers release the lock on visibilitychange → hidden.
 */
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) {
      // Release if previously held.
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
      return;
    }

    // Some TS lib targets don't include navigator.wakeLock.
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock?.request) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await nav.wakeLock!.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          // Cleared by browser (e.g. visibility change). Will re-acquire on visibilitychange.
          sentinelRef.current = null;
        });
      } catch {
        // Permissions / unsupported — ignore.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current && active) {
        acquire();
      }
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
    };
  }, [active]);
}
