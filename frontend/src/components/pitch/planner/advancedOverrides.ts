/** Power-user overrides for auto-sub planner thresholds. */
export interface AutoSubAdvancedOverrides {
  /** Standard mode: hard floor on the sub-window cadence (sec). Default 240. */
  standardIntervalFloorSec?: number;
  /** Standard mode: target/maximum sub-window cadence (sec). Default 420. */
  standardTargetIntervalSec?: number;
  /** Frequent mode: minimum gap between sub windows (sec). Default 180. */
  frequentIntervalFloorSec?: number;
  /** Minimum on-pitch shift before a player can be pulled (sec). Default 180. */
  minShiftSeconds?: number;
  /** Halftime guard: no interval-driven sub windows within this many sec of HT
   *  (when a halftime GK swap is scheduled). Default = the active interval floor. */
  halftimeGuardSeconds?: number;
  /** Override the Max-Spread cap (sec) coming from the parent settings. When
   *  set, replaces the `maxSpreadMinutes` prop value. Lower = stricter
   *  fairness (planner sacrifices queue order sooner). */
  maxSpreadOverrideSec?: number;
  /** Optional coach drag order: lower index = should be favoured for more time. */
  playerPriorityOrder?: string[];
}

export const ADV_DEFAULTS = {
  standardTargetIntervalSec: 7 * 60,   // 420
  standardIntervalFloorSec: 4 * 60,    // 240
  frequentIntervalFloorSec: 180,
  minShiftSeconds: 180,
  halftimeGuardSeconds: 180,
} as const;
