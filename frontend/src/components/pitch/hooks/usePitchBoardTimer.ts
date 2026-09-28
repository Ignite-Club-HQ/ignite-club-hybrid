/**
 * Step 1 of PitchBoard.tsx split (audit #9).
 *
 * Owns the per-tick minute math + game-in-progress flag. Extracted verbatim
 * from PitchBoard.tsx — no behavior changes. The component still owns
 * `handleHalfChange`, the GameTimer JSX, and reset wiring; this hook only
 * encapsulates:
 *
 *   - `gameInProgress` state (seeded from saved timer state)
 *   - `timerResetKey` (force-remount key for GameTimer instances)
 *   - `lastTimeUpdateRef` / `hasInitializedTimeRef` (pre-init from saved
 *     timer state to prevent double-counting on resume)
 *   - `handleTimerUpdate` (delta-based minute accumulation per on-pitch
 *     player, with halftime-crossing catch-up and total-elapsed cap)
 *
 * Keeping the saved-state pre-init INSIDE this hook (rather than in the
 * component body) is intentional: it keeps the "do not re-add already-
 * captured minutes on remount" contract co-located with the consumer
 * (handleTimerUpdate). See the long comment block originally at
 * PitchBoard.tsx:225–242.
 */
import { useCallback, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from "react";
import type { GameTimerRef } from "../GameTimer";
import type { Player } from "../types";
import type { PitchBoardState } from "../types";
import { loadTimerStateForMinutes } from "../pitchStateUtils";
import { getCurrentGameSeconds } from "../timerUtils";

interface UsePitchBoardTimerOptions {
  teamId: string;
  savedState: PitchBoardState | null;
  /** Live ref to the component's `minutesPerHalf` state (used only as a
   *  fallback when the GameTimer instance hasn't reported one yet). */
  minutesPerHalfRef: RefObject<number>;
  gameTimerRef: RefObject<GameTimerRef | null>;
  /**
   * Refs to setters / callbacks that are created later in the component
   * body (after `useState<Player[]>`, `useAutoSubs`, etc.). Passing them
   * as refs lets this hook run at the top of the component, before those
   * declarations exist. The component is responsible for assigning
   * `.current` once the underlying value is available — mirrors the
   * existing pattern with `pushToUndoHistoryRef_autoSubs` /
   * `runSubAnimationRef_autoSubs`.
   */
  setPlayersRef: RefObject<Dispatch<SetStateAction<Player[]>> | null>;
  setElapsedGameTimeRef: RefObject<Dispatch<SetStateAction<number>> | null>;
  updateNextSubInfoRef: RefObject<((elapsedSeconds: number, currentHalf: 1 | 2) => void) | null>;
  checkForDueSubsRef: RefObject<((elapsedSeconds: number, currentHalf: 1 | 2) => void) | null>;
}

export interface UsePitchBoardTimerResult {
  gameInProgress: boolean;
  setGameInProgress: Dispatch<SetStateAction<boolean>>;
  timerResetKey: number;
  setTimerResetKey: Dispatch<SetStateAction<number>>;
  /** Last (seconds, half) we credited minutes for. Mutated by handleTimerUpdate. */
  lastTimeUpdateRef: RefObject<{ seconds: number; half: 1 | 2 } | null>;
  /** Set true once handleTimerUpdate has initialized (or the savedState seed ran). */
  hasInitializedTimeRef: RefObject<boolean>;
  handleTimerUpdate: (elapsedSeconds: number, currentHalf: 1 | 2) => void;
}

export function usePitchBoardTimer({
  teamId,
  savedState,
  minutesPerHalfRef,
  gameTimerRef,
  setPlayersRef,
  setElapsedGameTimeRef,
  updateNextSubInfoRef,
  checkForDueSubsRef,
}: UsePitchBoardTimerOptions): UsePitchBoardTimerResult {
  // Pre-initialize time-tracking refs based on saved timer state. Without
  // this, GameTimer initializes with elapsedSeconds=0, fires
  // handleTimerUpdate(0), then restores to the full elapsed time, causing
  // handleTimerUpdate to add a delta equal to the entire game duration —
  // doubling minutes.
  const lastTimeUpdateRef = useRef<{ seconds: number; half: 1 | 2 } | null>(null);
  const hasInitializedTimeRef = useRef(false);
  if (savedState && !hasInitializedTimeRef.current) {
    const timerNow = loadTimerStateForMinutes(teamId);
    if (timerNow) {
      const halfElapsed = getCurrentGameSeconds(timerNow);
      const currentHalf = (timerNow.currentHalf || 1) as 1 | 2;
      lastTimeUpdateRef.current = { seconds: halfElapsed, half: currentHalf };
      hasInitializedTimeRef.current = true;
      console.log("[PitchState] Pre-initialized time ref:", { halfElapsed, currentHalf });
    }
  }

  // Game-in-progress flag. Seed from saved timer state so a page reload
  // mid-match (or a parent re-render before the first timer tick) cannot
  // let the prop-sync effect on minutesPerHalf clobber the live value with
  // a transient `|| 10` fallback from the parent.
  const [gameInProgress, setGameInProgress] = useState<boolean>(() => {
    try {
      const t = loadTimerStateForMinutes(teamId);
      if (!t) return false;
      return !!(t.isRunning || (t.elapsedSeconds && t.elapsedSeconds > 0) || t.currentHalf === 2 || t.isGameFinished);
    } catch {
      return false;
    }
  });

  // Key to force-remount GameTimer instances on reset.
  const [timerResetKey, setTimerResetKey] = useState(0);

  const handleTimerUpdate = useCallback((elapsedSeconds: number, currentHalf: 1 | 2) => {
    // Mark game as in progress once timer starts
    if (elapsedSeconds > 0 && !gameInProgress) {
      setGameInProgress(true);
    }

    // On first call, initialize the ref so the next tick computes a correct delta.
    // We do NOT return early — we still want sub checks below to run.
    if (!hasInitializedTimeRef.current) {
      hasInitializedTimeRef.current = true;
      lastTimeUpdateRef.current = { seconds: elapsedSeconds, half: currentHalf };
      // Fall through — no time is added because delta will be 0 on this call
    }

    // Track minutes played for players on pitch
    const lastUpdate = lastTimeUpdateRef.current;
    if (lastUpdate) {
      let secondsElapsed = 0;
      const halfDuration = (gameTimerRef.current?.getMinutesPerHalf() || (minutesPerHalfRef.current ?? 10)) * 60;
      if (lastUpdate.half === currentHalf && elapsedSeconds > lastUpdate.seconds) {
        // Normal tick within the same half
        secondsElapsed = elapsedSeconds - lastUpdate.seconds;
      } else if (lastUpdate.half === 1 && currentHalf === 2) {
        // Half transition. Two sub-cases collapse into one formula:
        //   - Normal end-of-H1 tick: elapsedSeconds === 0 → credit
        //     (halfDuration - lastUpdate.seconds), i.e. the final second(s)
        //     of H1 that GameTimer wraps when it flips to H2.
        //   - Resume / drift catch-up that crosses halftime: elapsedSeconds
        //     can be > 0 in H2 (see GameTimer.tsx ~L656). We must credit the
        //     remainder of H1 PLUS the elapsed start of H2, otherwise the
        //     whole halftime-crossing window vanishes from per-player minutes
        //     and stats under-count by a large margin.
        secondsElapsed = Math.max(0, halfDuration - lastUpdate.seconds) + Math.max(0, elapsedSeconds);
      }
      if (secondsElapsed > 0) {
        // Cap each player's minutesPlayed at total elapsed game time.
        // Defensive guard against double-accumulation (duplicated ticks,
        // half-transition catchup colliding with a normal tick, or stale
        // refs after remount). A player's on-pitch time can never logically
        // exceed total game elapsed.
        const totalElapsedNow = currentHalf === 2
          ? halfDuration + elapsedSeconds
          : elapsedSeconds;
        setPlayersRef.current?.(prev => prev.map(p => {
          if (p.position !== null) {
            const next = (p.minutesPlayed || 0) + secondsElapsed;
            return { ...p, minutesPlayed: Math.min(next, totalElapsedNow) };
          }
          return p;
        }));
      }
    }
    lastTimeUpdateRef.current = { seconds: elapsedSeconds, half: currentHalf };

    // Update reactive elapsed game time for MatchStatsPanel
    const totalElapsed = currentHalf === 2
      ? (gameTimerRef.current?.getMinutesPerHalf() || (minutesPerHalfRef.current ?? 10)) * 60 + elapsedSeconds
      : elapsedSeconds;
    setElapsedGameTimeRef.current?.(totalElapsed);

    // Delegate next-sub countdown and due-sub detection to the auto-sub hook.
    // Refs because useAutoSubs runs later in the parent component.
    updateNextSubInfoRef.current?.(elapsedSeconds, currentHalf);
    checkForDueSubsRef.current?.(elapsedSeconds, currentHalf);
  }, [gameInProgress, minutesPerHalfRef, gameTimerRef, setPlayersRef, setElapsedGameTimeRef, updateNextSubInfoRef, checkForDueSubsRef]);

  return {
    gameInProgress,
    setGameInProgress,
    timerResetKey,
    setTimerResetKey,
    lastTimeUpdateRef,
    hasInitializedTimeRef,
    handleTimerUpdate,
  };
}
