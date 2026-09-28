/**
 * Phase 3 — Unified sub-window time builder.
 *
 * Single source of truth for "when can a substitution happen" across both
 * Standard and Frequent modes. The only difference between modes is the
 * numeric inputs into this function.
 *
 * Inputs are absolute seconds (game-clock from kickoff = 0).
 * Returns a sorted, de-duplicated array of absolute window times.
 */

export interface BuildSubWindowsInput {
  /** Absolute kickoff-relative second the planner starts working from. */
  startAbs: number;
  /** Absolute kickoff-relative second the game ends. */
  endAbs: number;
  /** Length of one half (sec). Halftime is at this absolute time. */
  halfDurationSeconds: number;

  /** Desired cadence between interval-driven windows (sec). */
  targetIntervalSec: number;
  /** Hard floor on cadence — interval is clamped to ≥ this (sec). */
  intervalFloorSec: number;

  /** Settling-in window after kickoff and after halftime (sec). */
  noSubBeforeSec: number;
  /** Trailing window before half-end and full-time (sec). */
  noSubAfterSec: number;

  /**
   * If `halftimeGuardActive`, drop interval candidates within this many
   * seconds either side of halftime. (Used when a halftime GK swap is
   * scheduled — avoids generating a sub seconds before HT.)
   */
  halftimeGuardSec: number;
  halftimeGuardActive: boolean;

  /**
   * Skip interval candidates this close to a half boundary (defaults to 45 s).
   * Independent of `noSubAfterSec` — covers the small "snap-to-half" zone.
   */
  edgeBufferSec?: number;

  /**
   * Forced windows that bypass blackouts and SUPPRESS nearby interval-driven
   * windows (within `forcedBufferSec`). Used for GK-protected outfield runs.
   */
  forcedTimes?: number[];

  /**
   * Extra windows that bypass blackouts but do NOT suppress others.
   * (Today's fairness rescues.) Already filtered by the caller if needed.
   */
  extraTimes?: number[];

  /** Suppression radius around each `forcedTime` for non-forced windows. */
  forcedBufferSec?: number;

  /** Always include the exact halftime second when guard is active. */
  includeHalftimeWhenGuardActive?: boolean;
}

/**
 * True iff `t` falls in any planner blackout (settling-in, end-of-half,
 * halftime guard).
 */
export function isInBlackout(
  t: number,
  opts: Pick<
    BuildSubWindowsInput,
    | "halfDurationSeconds"
    | "endAbs"
    | "noSubBeforeSec"
    | "noSubAfterSec"
    | "halftimeGuardSec"
    | "halftimeGuardActive"
  >,
): boolean {
  const {
    halfDurationSeconds,
    endAbs,
    noSubBeforeSec,
    noSubAfterSec,
    halftimeGuardSec,
    halftimeGuardActive,
  } = opts;
  // Last N seconds of half 1
  if (t > halfDurationSeconds - noSubAfterSec && t <= halfDurationSeconds) return true;
  // Last N seconds of half 2
  if (t > endAbs - noSubAfterSec) return true;
  // Halftime guard band
  if (halftimeGuardActive && Math.abs(t - halfDurationSeconds) < halftimeGuardSec) return true;
  // Settling-in window after kickoff
  if (t < noSubBeforeSec) return true;
  // Settling-in window after halftime
  if (t > halfDurationSeconds && t < halfDurationSeconds + noSubBeforeSec) return true;
  return false;
}

export function buildSubWindows(input: BuildSubWindowsInput): number[] {
  const {
    startAbs,
    endAbs,
    halfDurationSeconds,
    targetIntervalSec,
    intervalFloorSec,
    noSubBeforeSec,
    noSubAfterSec,
    halftimeGuardSec,
    halftimeGuardActive,
    edgeBufferSec = 45,
    forcedTimes = [],
    extraTimes = [],
    forcedBufferSec = 0,
    includeHalftimeWhenGuardActive = false,
  } = input;

  // Effective interval can never go below the floor.
  const intervalSec = Math.max(intervalFloorSec, Math.floor(targetIntervalSec));

  const blackoutOpts = {
    halfDurationSeconds,
    endAbs,
    noSubBeforeSec,
    noSubAfterSec,
    halftimeGuardSec,
    halftimeGuardActive,
  };

  // 1. Spread interval-driven candidates from the first plausible slot.
  const earliestAbs = Math.max(startAbs + 60, noSubBeforeSec, startAbs + intervalSec);
  const candidates: number[] = [];
  for (let t = earliestAbs; t < endAbs - noSubAfterSec; t += intervalSec) {
    // Snap-to-half edge buffer (independent of noSubAfter)
    if (t < halfDurationSeconds && halfDurationSeconds - t <= edgeBufferSec) continue;
    if (t > halfDurationSeconds && t - halfDurationSeconds <= edgeBufferSec) continue;
    if (isInBlackout(t, blackoutOpts)) continue;
    candidates.push(Math.floor(t));
  }

  // 2. Suppress interval candidates that sit too close to a forced window.
  const filteredCandidates = forcedBufferSec > 0 && forcedTimes.length > 0
    ? candidates.filter(t => !forcedTimes.some(ft => Math.abs(ft - t) <= forcedBufferSec))
    : candidates;

  // 3. Merge: forced + extra always survive blackouts; halftime always survives
  //    when caller asks for it.
  const merged = new Set<number>(filteredCandidates);
  for (const ft of forcedTimes) {
    if (ft > startAbs && ft < endAbs) merged.add(Math.floor(ft));
  }
  for (const et of extraTimes) {
    if (et > startAbs && et < endAbs) merged.add(Math.floor(et));
  }
  if (halftimeGuardActive && includeHalftimeWhenGuardActive) {
    merged.add(halfDurationSeconds);
  }

  return Array.from(merged).sort((a, b) => a - b);
}
