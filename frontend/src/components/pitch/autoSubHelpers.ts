/**
 * Shared auto-sub helper utilities.
 * Centralizes duplicated logic from PitchBoard.tsx and GlobalSubMonitor.tsx
 * to prevent divergence bugs.
 */
import { Player, SubstitutionEvent } from "./types";

/**
 * Generate a unique, deterministic key for a substitution event.
 * Used for matching subs across confirm/skip/execute flows.
 */
export const getSubKey = (sub: SubstitutionEvent): string =>
  `${sub.half}-${sub.time}-${sub.playerOut.id}`;

/**
 * Find the next due or upcoming substitution from a plan.
 * Returns the chronologically next unexecuted sub relative to the current game time.
 */
export const findNextSub = (
  plan: SubstitutionEvent[],
  currentHalf: 1 | 2,
  currentElapsedSeconds: number
): SubstitutionEvent | undefined => {
  const remaining = plan.filter(s => !s.executed);
  return (
    remaining.find(s => s.half === currentHalf && s.time >= currentElapsedSeconds) ||
    remaining.find(s => s.half > currentHalf) ||
    remaining[0]
  );
};

/**
 * Convert a sub schedule to absolute match seconds so halftime (2H 0:00)
 * correctly sorts after all first-half times.
 */
export const getSubTotalSeconds = (
  sub: SubstitutionEvent,
  halfDurationSeconds: number
): number => (sub.half === 1 ? sub.time : halfDurationSeconds + sub.time);

/**
 * Grace window (seconds): a missed sub that's no more than this many seconds
 * before the newest due sub is treated as still actionable, not stale.
 * Callers use this to decide whether to bundle a slightly-late sub into the
 * current confirm batch or auto-skip it as truly stale (e.g. game left
 * running for ages, app resumed long after).
 */
export const STALE_SUB_GRACE_SECONDS = 240;

/**
 * Split all due substitutions into the newest due batch and any older overdue ones.
 * This lets the app auto-skip stale groups and surface the latest actionable batch.
 */
export const getDueSubGroups = (
  plan: SubstitutionEvent[],
  currentHalf: 1 | 2,
  currentElapsedSeconds: number,
  halfDurationSeconds: number
): {
  latestDueSubs: SubstitutionEvent[];
  olderDueSubs: SubstitutionEvent[];
} => {
  const currentTotalSeconds = currentHalf === 1
    ? currentElapsedSeconds
    : halfDurationSeconds + currentElapsedSeconds;

  const dueSubs = plan.filter(
    sub => !sub.executed && getSubTotalSeconds(sub, halfDurationSeconds) <= currentTotalSeconds
  );

  if (dueSubs.length === 0) {
    return { latestDueSubs: [], olderDueSubs: [] };
  }

  const latestDueTotalSeconds = Math.max(
    ...dueSubs.map(sub => getSubTotalSeconds(sub, halfDurationSeconds))
  );

  return {
    latestDueSubs: dueSubs.filter(
      sub => getSubTotalSeconds(sub, halfDurationSeconds) === latestDueTotalSeconds
    ),
    olderDueSubs: dueSubs.filter(
      sub => getSubTotalSeconds(sub, halfDurationSeconds) < latestDueTotalSeconds
    ),
  };
};

/**
 * Pick the most relevant sub for controls/UI.
 * If any sub group is already due, prefer the newest due batch; otherwise return the next scheduled sub.
 */
export const findRelevantNextSub = (
  plan: SubstitutionEvent[],
  currentHalf: 1 | 2,
  currentElapsedSeconds: number,
  halfDurationSeconds: number
): SubstitutionEvent | undefined => {
  const { latestDueSubs } = getDueSubGroups(
    plan,
    currentHalf,
    currentElapsedSeconds,
    halfDurationSeconds
  );

  if (latestDueSubs.length > 0) {
    return latestDueSubs[0];
  }

  return findNextSub(plan, currentHalf, currentElapsedSeconds);
};

/**
 * Find all subs in the same time window as the given sub (batch partners).
 */
export const findBatchSubs = (
  plan: SubstitutionEvent[],
  primarySub: SubstitutionEvent
): SubstitutionEvent[] => {
  return plan.filter(
    s => !s.executed && s.half === primarySub.half && s.time === primarySub.time && s !== primarySub
  );
};

/**
 * Execute a list of substitutions on a player array, returning the updated players.
 * Handles position swaps, bench-replacement fallbacks, and invalid-sub skipping.
 * Returns { updatedPlayers, executedSubKeys, successCount }.
 */
export const executeSubsOnPlayers = (
  allSubs: SubstitutionEvent[],
  currentPlayers: Player[]
): {
  updatedPlayers: Player[];
  executedSubKeys: string[];
  skippedSubKeys: string[];
  successCount: number;
} => {
  let updatedPlayers = [...currentPlayers];
  const executedSubKeys: string[] = [];
  const skippedSubKeys: string[] = [];
  let successCount = 0;

  for (const sub of allSubs) {
    const { playerOut, playerIn, positionSwap } = sub;

    const currentPlayerOut = updatedPlayers.find(p => p.id === playerOut.id);
    let currentPlayerIn = updatedPlayers.find(p => p.id === playerIn.id);
    let actualPlayerInId = playerIn.id;

    // Validate playerIn is on bench (position === null)
    if (!currentPlayerIn || currentPlayerIn.position !== null) {
      // Try bench replacement
      const benchReplacement = updatedPlayers.find(
        p =>
          p.position === null &&
          !p.isInjured &&
          p.id !== playerOut.id &&
          !(p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) &&
          !allSubs.some(s => s.playerIn.id === p.id && s !== sub)
      );

      if (benchReplacement) {
        currentPlayerIn = benchReplacement;
        actualPlayerInId = benchReplacement.id;
      } else {
        skippedSubKeys.push(getSubKey(sub));
        continue;
      }
    }

    // Validate playerOut is on pitch
    if (!currentPlayerOut?.position) {
      skippedSubKeys.push(getSubKey(sub));
      continue;
    }

    const pitchPosition = { ...currentPlayerOut.position };
    const pitchPositionType = currentPlayerOut.currentPitchPosition;

    // Apply position swap if using original playerIn
    if (positionSwap && actualPlayerInId === playerIn.id) {
      const swapPlayer = updatedPlayers.find(p => p.id === positionSwap.player.id);
      if (swapPlayer?.position) {
        const swapPosition = { ...swapPlayer.position };
        updatedPlayers = updatedPlayers.map(p => {
          if (p.id === playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
          if (p.id === positionSwap.player.id) return { ...p, position: pitchPosition, currentPitchPosition: positionSwap.toPosition };
          if (p.id === actualPlayerInId) return { ...p, position: swapPosition, currentPitchPosition: positionSwap.fromPosition };
          return p;
        });
      } else {
        updatedPlayers = updatedPlayers.map(p => {
          if (p.id === playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
          if (p.id === actualPlayerInId) return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
          return p;
        });
      }
    } else {
      updatedPlayers = updatedPlayers.map(p => {
        if (p.id === playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
        if (p.id === actualPlayerInId) return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
        return p;
      });
    }

    executedSubKeys.push(getSubKey(sub));
    successCount++;
  }

  return { updatedPlayers, executedSubKeys, skippedSubKeys, successCount };
};

/**
 * Mark subs as executed in a plan by their keys.
 */
export const markSubsExecuted = (
  plan: SubstitutionEvent[],
  subKeys: string[],
  skipped = false
): SubstitutionEvent[] => {
  const keySet = new Set(subKeys);
  return plan.map(sub =>
    keySet.has(getSubKey(sub))
      ? { ...sub, executed: true, ...(skipped ? { skipped: true } : {}) }
      : sub
  );
};

/**
 * Calculate delay in seconds between when a sub was scheduled and current game time.
 */
export const calculateSubDelay = (
  sub: SubstitutionEvent,
  currentElapsed: number,
  currentHalf: 1 | 2,
  halfDurationSeconds: number
): number => {
  const subTotalSeconds = getSubTotalSeconds(sub, halfDurationSeconds);
  const currentTotalSeconds = currentHalf === 1 ? currentElapsed : halfDurationSeconds + currentElapsed;
  return Math.max(0, currentTotalSeconds - subTotalSeconds);
};

/**
 * Snap a computed sub time to respect half boundaries:
 * - Within 60s of end of first half → halftime (half 2, time 0)
 * - Within 60s of start of second half → halftime (half 2, time 0)
 * - Within 60s of full time → drop (returns null)
 */
export const snapSubTime = (
  absoluteSeconds: number,
  halfDurationSeconds: number
): { half: 1 | 2; time: number } | null => {
  const BOUNDARY_THRESHOLD = 60;

  if (absoluteSeconds < halfDurationSeconds) {
    // First half
    if (halfDurationSeconds - absoluteSeconds <= BOUNDARY_THRESHOLD) {
      return { half: 2, time: 0 }; // Snap to halftime
    }
    return { half: 1, time: Math.floor(absoluteSeconds) };
  } else {
    // Second half
    const timeInSecondHalf = absoluteSeconds - halfDurationSeconds;
    if (timeInSecondHalf <= BOUNDARY_THRESHOLD) {
      return { half: 2, time: 0 }; // Snap to halftime
    }
    if (halfDurationSeconds - timeInSecondHalf <= BOUNDARY_THRESHOLD) {
      return null; // Too close to full time — drop
    }
    return { half: 2, time: Math.floor(timeInSecondHalf) };
  }
};
