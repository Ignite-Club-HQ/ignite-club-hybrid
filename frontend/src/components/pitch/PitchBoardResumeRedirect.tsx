import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import {
  PITCH_BOARD_OPEN_KEY,
  PITCH_BOARD_OPEN_PATH_KEY,
  PITCH_BOARD_OPEN_AT_KEY,
  PITCH_BOARD_BACKGROUNDED_AT_KEY,
} from "./types";
import { clearPitchBoardOpenFlag } from "./pitchBoardOpenFlag";

/** How recently the board must have been mounted for a persisted open flag to
 *  count as a genuine restore signal (covers a long phone-lock + slow cold
 *  start, while still self-healing truly stale flags). */
const RECENT_OPEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// Native cold starts can spend well over six seconds restoring auth, profile,
// theme and legal state. Keep the restore lease alive across that bootstrap so
// a later redirect cannot strand the user on another protected page.
const RESTORE_WINDOW_MS = 30_000;
const RESTORE_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000, 5000, 8000, 12_000, 20_000, 29_000] as const;
// Route changes seen while hidden, or within this grace period after the app
// came back to the foreground, are treated as native WebView route drift.
const DRIFT_GRACE_MS = RESTORE_WINDOW_MS;

function markBackgrounded() {
  try {
    localStorage.setItem(PITCH_BOARD_BACKGROUNDED_AT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * True when the app is currently hidden, or was hidden recently enough that a
 * route change is more likely OS-driven route drift than a deliberate user
 * navigation. Used to protect the open marker from being cleared by drift.
 */
function isNativeRouteDriftLikely() {
  try {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return true;
    }
    const at = Number(
      localStorage.getItem(PITCH_BOARD_BACKGROUNDED_AT_KEY) || "0",
    );
    return Number.isFinite(at) && at > 0 && Date.now() - at < DRIFT_GRACE_MS;
  } catch {
    return false;
  }
}

const isPublicBootstrapPath = (path: string) =>
  path === "/auth" ||
  path === "/reset-password" ||
  path === "/verify-reset-code" ||
  path === "/complete-profile" ||
  path === "/terms" ||
  path === "/privacy";

/**
 * Restores the pitch board after a WebView cold-start (iOS lock/unlock kills
 * the WebView, Android low-memory kills the process). We persist the open
 * flag + last route while the board is mounted; on cold-start the app loads
 * back at "/" and this component navigates to the stored event route with
 * ?openPitchBoard=1 so the board auto-opens again.
 *
 * Triggers:
 *  - Component mount (cold start).
 *  - Native `appStateChange isActive=true` (warm resume — covers cases where
 *    the WebView survived but the in-memory React state was lost).
 *
 * We never redirect AWAY from a non-neutral route the user is on — only from
 * the landing page — so an intentional navigation isn't yanked back.
 */
export default function PitchBoardResumeRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const lastAttemptRef = useRef(0);
  // Restore is only allowed inside a short window after a true cold-start
  // or resume signal (mount, appStateChange isActive, visibilitychange,
  // pageshow). Outside that window, ordinary in-app navigation (e.g. user
  // taps Home in the bottom nav from /messages → "/") must NOT trigger a
  // restore — otherwise the pitch board re-opens unexpectedly whenever the
  // user lands on a neutral route after closing it earlier.
  const restoreWindowUntilRef = useRef(0);
  const openRestoreWindow = (ms = RESTORE_WINDOW_MS) => {
    restoreWindowUntilRef.current = Math.max(
      restoreWindowUntilRef.current,
      Date.now() + ms,
    );
  };

  // Stable restore fn — reads current location via ref so it's safe across
  // listeners without forcing re-binding.
  const attemptRestoreRef = useRef<() => void>(() => {});
  attemptRestoreRef.current = () => {
    // Outside an explicit cold-start/resume window — do nothing. This is the
    // guard that prevents bottom-nav Home (or any in-app nav back to "/")
    // from re-opening the pitch board.
    if (Date.now() > restoreWindowUntilRef.current) return;
    // If PitchBoard is already mounted in this JS context, nothing to do —
    // avoid yanking the URL and forcing an unmount/remount loop.
    if ((window as any).__pitchBoardMounted === true) return;

    // Suppress warm-resume restores when the persisted flag is stale (left
    // over from a previous run or a never-cleared crash path). Two signals
    // count as "genuinely open":
    //  - the board mounted in THIS JS session, or
    //  - the persisted open stamp is recent (board was mounted shortly before
    //    the WebView was torn down by the OS).
    // The old check used a fixed 8s cold-start window, which silently refused
    // to restore on slow cold starts (auth restore + theme + legal gate can
    // push the first mount past 8s), leaving the user on the team page with
    // the board gone — exactly the reported bug.
    const wasMountedThisSession =
      (window as any).__pitchBoardMountedThisSession === true;
    let openedRecently = false;
    try {
      const openedAt = Number(
        localStorage.getItem(PITCH_BOARD_OPEN_AT_KEY) || "0",
      );
      openedRecently =
        Number.isFinite(openedAt) &&
        openedAt > 0 &&
        Date.now() - openedAt < RECENT_OPEN_MAX_AGE_MS;
    } catch {
      openedRecently = false;
    }
    if (!wasMountedThisSession && !openedRecently) {
      // Self-heal: clear the stale flag so we don't keep re-checking.
      clearPitchBoardOpenFlag();
      return;
    }

    try {
      if (localStorage.getItem(PITCH_BOARD_OPEN_KEY) !== "true") return;
      const storedPath = localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY);
      if (!storedPath) return;

      const loc = locationRef.current;
      const [path, query = ""] = storedPath.split("?");

      // Modal-on-home case: storedPath === "/"; nothing for us to do —
      // HomePage runs its own cold-start restore that re-opens the modal.
      if (path === "/" || path === "/home") return;

      const onStored = loc.pathname === path;

      // During a genuine cold-start/resume lease the open board is the
      // authoritative foreground destination. Auth/profile/bootstrap and
      // pending navigation effects can briefly move the router to another
      // protected page after our first attempt; reclaim it on a later retry.
      // Never override public auth/legal flows.
      if (!onStored && isPublicBootstrapPath(loc.pathname)) return;

      // Already mid-restore (param present and on the right path) → nothing to do.
      const currentParams = new URLSearchParams(loc.search);
      if (onStored && currentParams.get("openPitchBoard") === "1") return;

      // Debounce — multiple triggers (mount + RAF + appStateChange + location
      // change) can fire in the same tick; coalesce to one navigate().
      const now = Date.now();
      if (now - lastAttemptRef.current < 250) return;
      lastAttemptRef.current = now;

      const params = new URLSearchParams(query);
      params.set("openPitchBoard", "1");
      // The drift marker has served its purpose for this resume — clear it so
      // a later deliberate navigation away is honoured as an explicit close.
      try {
        localStorage.removeItem(PITCH_BOARD_BACKGROUNDED_AT_KEY);
      } catch {
        /* ignore */
      }
      navigate(`${path}?${params.toString()}`, { replace: true });
    } catch {
      /* ignore */
    }
  };

  // Mount-only: set up cold-start retries + native/web visibility listeners.
  useEffect(() => {
    let cancelled = false;
    const attempt = () => attemptRestoreRef.current();

    // Cold start counts as a restore opportunity.
    openRestoreWindow();

    // Cold-start: try immediately, then with a generous retry ladder so we
    // catch the case where the URL is still /auth or the Suspense fallback
    // when the first attempt runs, and only resolves to "/" a few hundred
    // milliseconds later once the AuthProvider hydrates.
    const timers: number[] = [];
    const scheduleAttempt = (delayMs: number) => {
      const timer = window.setTimeout(() => {
        if (!cancelled) attempt();
      }, delayMs);
      timers.push(timer);
    };
    RESTORE_RETRY_DELAYS_MS.forEach(scheduleAttempt);

    // Warm resume on native: phone unlock often delivers appStateChange
    // before any other lifecycle signal.
    let removeListener: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void (async () => {
        try {
          const { App } = await import("@capacitor/app");
          const handle = await App.addListener("appStateChange", ({ isActive }) => {
            if (!isActive) {
              // Backgrounding: any route change from here until the drift
              // grace period expires is OS-driven, not user intent.
              markBackgrounded();
              openRestoreWindow();
              return;
            }
            openRestoreWindow();
            // Retry across the post-resume hydration window — Capacitor
            // sometimes restores the WebView to the start URL ("/") and
            // React needs a frame or two to finish bootstrap.
            attempt();
            scheduleAttempt(400);
            scheduleAttempt(1200);
          });
          if (cancelled) {
            void handle.remove();
          } else {
            removeListener = () => {
              void handle.remove();
            };
          }
        } catch {
          /* native module unavailable — fine */
        }
      })();
    }

    // Web/PWA fallback: when the tab becomes visible again.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        openRestoreWindow();
        attempt();
      } else {
        markBackgrounded();
        openRestoreWindow();
      }
    };
    // pageshow fires after WebView bfcache restore (iOS Safari/WKWebView).
    const onPageShow = () => {
      openRestoreWindow();
      attempt();
    };
    const onPageHide = () => {
      markBackgrounded();
      openRestoreWindow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      removeListener?.();
    };
  }, []);

  // Track previous pathname so we can detect explicit user navigation AWAY
  // from the stored pitch-board path. If, during an open restore window
  // (e.g. just after phone unlock), the user taps Home in the bottom nav
  // from the board's route to "/", that's an intentional close — shut the
  // window and clear the persisted flag so we don't bounce them back into
  // the board on the next attempt.
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    const prev = prevPathRef.current;
    const next = location.pathname;
    prevPathRef.current = next;

    try {
      const storedPath = (
        localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY) || ""
      ).split("?")[0];
      if (
        storedPath &&
        prev === storedPath &&
        prev !== next &&
        // Route changes caused by cold-start/resume bootstrap are allowed to
        // settle and will be reclaimed by attemptRestore. Outside that lease,
        // leaving the board's route is an explicit navigation and must clear
        // the flag so it does not reopen later.
        Date.now() > restoreWindowUntilRef.current &&
        // Native WebView route drift (route changed while the app was hidden
        // or right after it came back) is NOT a deliberate close.
        !isNativeRouteDriftLikely()
      ) {
        // User left the pitch-board route — treat as explicit close.
        restoreWindowUntilRef.current = 0;
        clearPitchBoardOpenFlag();
        return;
      }
    } catch {
      /* ignore */
    }

    attemptRestoreRef.current();
  }, [location.pathname]);

  return null;
}
