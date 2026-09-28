/**
 * Centralized timer projection utilities.
 * Single source of truth for extrapolating elapsed game seconds from a TimerState.
 * Replaces ~12 duplicated inline blocks across the pitch module.
 */
import { TimerState } from "./types";

/** Maximum seconds for UI-only optimistic extrapolation where callers explicitly
 *  want a short visual prediction rather than authoritative wall-clock time. */
export const MAX_EXTRAPOLATION_SECS = 30;

/**
 * Calculate how many seconds have actually passed since the timer was last persisted,
 * capped to MAX_EXTRAPOLATION_SECS.
 */
export const getSecondsSinceUpdate = (
  lastUpdateTime: number | undefined | null,
  now: number = Date.now()
): number => {
  if (!lastUpdateTime) return 0;
  return Math.min(
    Math.max(0, Math.floor((now - lastUpdateTime) / 1000)),
    MAX_EXTRAPOLATION_SECS
  );
};

/**
 * Like getSecondsSinceUpdate but WITHOUT the 30s cap.
 * Used for authoritative timer persistence/resume. Native WebViews throttle or
 * suspend JS timers while locked/backgrounded, so Date.now() is the source of truth.
 */
export const getSecondsSinceUpdateUncapped = (
  lastUpdateTime: number | undefined | null,
  now: number = Date.now()
): number => {
  if (!lastUpdateTime) return 0;
  return Math.max(0, Math.floor((now - lastUpdateTime) / 1000));
};

type ProjectableTimerState = Pick<
  TimerState,
  "minutesPerHalf" | "currentHalf" | "elapsedSeconds" | "isRunning" | "lastUpdateTime"
> & {
  isGameFinished?: boolean;
  gameFinishedAt?: number;
};

export const projectRunningTimerState = <T extends ProjectableTimerState>(
  timerState: T,
  now: number = Date.now()
): { timerState: T; secondsAdvanced: number; crossedHalf: boolean; finished: boolean } => {
  const halfDuration = Math.max(0, (timerState.minutesPerHalf || 0) * 60);
  if (!timerState.isRunning || timerState.isGameFinished || halfDuration <= 0) {
    return { timerState: { ...timerState, lastUpdateTime: now }, secondsAdvanced: 0, crossedHalf: false, finished: !!timerState.isGameFinished };
  }

  const secondsAdvanced = getSecondsSinceUpdateUncapped(timerState.lastUpdateTime, now);
  let currentHalf: 1 | 2 = timerState.currentHalf;
  let elapsedSeconds = Math.max(0, timerState.elapsedSeconds || 0) + secondsAdvanced;
  let isRunning: boolean = timerState.isRunning;
  let crossedHalf = false;
  let finished = false;

  if (currentHalf === 1 && elapsedSeconds >= halfDuration) {
    currentHalf = 2;
    elapsedSeconds -= halfDuration;
    isRunning = false;
    crossedHalf = true;
  }

  if (currentHalf === 2 && elapsedSeconds >= halfDuration) {
    elapsedSeconds = halfDuration;
    isRunning = false;
    finished = true;
  }

  return {
    timerState: {
      ...timerState,
      currentHalf,
      elapsedSeconds,
      isRunning,
      lastUpdateTime: now,
      isGameFinished: finished || timerState.isGameFinished,
      ...(finished && !timerState.gameFinishedAt ? { gameFinishedAt: now } : {}),
    },
    secondsAdvanced,
    crossedHalf,
    finished,
  };
};

/**
 * Get the current projected elapsed seconds for the active half.
 * This is the ONE function all code should call instead of inline extrapolation.
 *
 * @param timerState - The persisted timer state (or null)
 * @param now - Optional timestamp override (for testing / consistent reads)
 * @returns Elapsed seconds clamped to [0, halfDuration]
 */
export const getCurrentGameSeconds = (
  timerState: TimerState | null | undefined,
  now: number = Date.now()
): number => {
  if (!timerState) return 0;

  const halfDuration = timerState.minutesPerHalf * 60;
  const base = timerState.elapsedSeconds || 0;

  if (!timerState.isRunning) {
    return Math.min(base, halfDuration);
  }

  const extrapolated = base + getSecondsSinceUpdateUncapped(timerState.lastUpdateTime, now);
  return Math.min(extrapolated, halfDuration);
};
