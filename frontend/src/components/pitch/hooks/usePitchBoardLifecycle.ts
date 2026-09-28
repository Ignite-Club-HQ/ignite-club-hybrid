import { useEffect, useRef, type MutableRefObject } from "react";
import {
  PITCH_BOARD_OPEN_KEY,
  PITCH_BOARD_OPEN_PATH_KEY,
  PITCH_BOARD_LAST_CONTEXT_KEY,
  PITCH_BOARD_OPEN_AT_KEY,
} from "../types";
import { loadTimerStateForMinutes } from "../pitchStateUtils";

interface UsePitchBoardLifecycleArgs {
  teamId: string;
  teamName?: string;
  readOnly?: boolean;
  subConfirmDialogOpen: boolean;
  toast: (opts: { title: string; description?: string }) => void;
}

interface UsePitchBoardLifecycleResult {
  autoResetDoneRef: MutableRefObject<boolean>;
  shouldAutoReset: MutableRefObject<boolean>;
}

/**
 * Step 9e — open-flag/context lifecycle + expired-sub notification + auto-reset.
 *
 * Combines three lifecycle effects:
 *  1. Open-flag + path persistence (mount-only, never re-runs on prop change).
 *  2. Restore-context refresh on teamId/teamName/readOnly changes.
 *  3. Expired pending_sub notification toast.
 *  4. Auto-reset 30 min after game completion (sets refs only).
 */
export function usePitchBoardLifecycle({
  teamId,
  teamName,
  readOnly,
  subConfirmDialogOpen,
  toast,
}: UsePitchBoardLifecycleArgs): UsePitchBoardLifecycleResult {
  const subConfirmDialogOpenRef = useRef(subConfirmDialogOpen);
  subConfirmDialogOpenRef.current = subConfirmDialogOpen;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // 1. Open-flag + path (mount-only; see PitchBoard note for why).
  //
  // IMPORTANT: We deliberately do NOT clear PITCH_BOARD_OPEN_KEY /
  // PITCH_BOARD_OPEN_PATH_KEY / PITCH_BOARD_LAST_CONTEXT_KEY on unmount.
  // PitchBoard can unmount for many transient reasons unrelated to the user
  // closing it:
  //  - Parent query refetch briefly flips a gating prop
  //    (e.g. hasProFootball) and re-mounts the portal.
  //  - iOS WebView suspend on screen-lock tears down the React tree while
  //    the OS keeps the process alive (only happens for some game states —
  //    notably when a game is running and other native work keeps the app
  //    alive past the usual freeze).
  //  - Low-memory remounts on Android.
  // If unmount cleanup wiped the flag, PitchBoardResumeRedirect would have
  // nothing to restore on resume and the user would land on the team page
  // with the board gone. The flag is cleared explicitly via
  // `clearPitchBoardOpenFlag()` from the close handlers instead.
  useEffect(() => {
    localStorage.setItem(PITCH_BOARD_OPEN_KEY, "true");
    try {
      const path = window.location.pathname + window.location.search;
      localStorage.setItem(PITCH_BOARD_OPEN_PATH_KEY, path);
      localStorage.setItem(PITCH_BOARD_OPEN_AT_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    (window as any).__pitchBoardMounted = true;
    // Sticky "was ever mounted in this JS session" flag. Used by
    // PitchBoardResumeRedirect to suppress warm-resume restores when the
    // board was never opened this session (stale localStorage flag).
    (window as any).__pitchBoardMountedThisSession = true;
    localStorage.removeItem("pitch-widget-dismissed");
    return () => {
      // Only flip the in-memory mounted marker so PitchBoardResumeRedirect
      // can re-attempt a restore. The persisted open flag stays put — see
      // the IMPORTANT comment above.
      (window as any).__pitchBoardMounted = false;
    };
  }, []);

  // 2. Restore-context refresh (no flag clearing) + open-recency heartbeat.
  useEffect(() => {
    const stamp = () => {
      try {
        localStorage.setItem(
          PITCH_BOARD_LAST_CONTEXT_KEY,
          JSON.stringify({ teamId, teamName, readOnly })
        );
        const path = window.location.pathname + window.location.search;
        localStorage.setItem(PITCH_BOARD_OPEN_PATH_KEY, path);
        localStorage.setItem(PITCH_BOARD_OPEN_AT_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    };
    stamp();
    // Heartbeat keeps the "open at" stamp fresh during long sessions so the
    // resume restore still recognises the board as genuinely open after a
    // lock/unlock cycle late in a game.
    const interval = window.setInterval(stamp, 60_000);
    return () => window.clearInterval(interval);
  }, [teamId, teamName, readOnly]);

  // 3. Expired sub notification toast.
  useEffect(() => {
    const checkExpiredSub = () => {
      const source = localStorage.getItem("pitch-board-open-source");
      if (source !== "pending_sub") return;
      localStorage.removeItem("pitch-board-open-source");

      setTimeout(() => {
        if (!subConfirmDialogOpenRef.current) {
          toastRef.current({
            title: "Substitution has passed",
            description:
              "That substitution is no longer pending. You can review the current game state here.",
          });
        }
      }, 1500);
    };

    checkExpiredSub();
    const handleOpenEvent = () => checkExpiredSub();
    window.addEventListener("open-pitch-board", handleOpenEvent);
    return () => window.removeEventListener("open-pitch-board", handleOpenEvent);
  }, []);

  // 4. Auto-reset 30 min after game completion.
  const autoResetDoneRef = useRef(false);
  const shouldAutoReset = useRef(false);
  useEffect(() => {
    if (autoResetDoneRef.current) return;
    const timerState = loadTimerStateForMinutes(teamId);
    if (timerState?.isGameFinished && timerState?.gameFinishedAt) {
      const minutesSinceFinished =
        (Date.now() - timerState.gameFinishedAt) / (1000 * 60);
      if (minutesSinceFinished >= 30) {
        shouldAutoReset.current = true;
        autoResetDoneRef.current = true;
        console.log(
          `Game for team ${teamId} finished ${Math.round(minutesSinceFinished)} mins ago - will auto-reset`
        );
      }
    }
  }, [teamId]);

  return { autoResetDoneRef, shouldAutoReset };
}
