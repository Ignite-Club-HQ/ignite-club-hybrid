/**
 * Auto-sub plan selectors — pure derivations over plan state.
 *
 * Every UI consumer that needs to ask "what's the next sub?", "how many
 * remain?", "is the plan done?" should go through these helpers instead
 * of re-implementing the filter inline. Centralising the derivations
 * keeps semantics consistent (e.g. "remaining" excludes skipped entries
 * because skipped is a subset of executed) and gives us a single place
 * to add memoisation later if it ever shows up in profiles.
 *
 * No React, no side-effects.
 */
import type { SubstitutionEvent } from "../types";
import { findRelevantNextSub, getSubKey } from "../autoSubHelpers";

/** Subs the user still needs to act on. Skipped subs carry `executed=true`. */
export function selectRemaining(plan: SubstitutionEvent[]): SubstitutionEvent[] {
  return plan.filter((s) => !s.executed);
}

/** Subs already executed OR skipped. Immutable from the reducer's POV. */
export function selectExecuted(plan: SubstitutionEvent[]): SubstitutionEvent[] {
  return plan.filter((s) => s.executed);
}

export function selectRemainingCount(plan: SubstitutionEvent[]): number {
  // Cheap dedicated counter — avoids allocating an intermediate array
  // on every render/tick when the caller only needs the count.
  let n = 0;
  for (const s of plan) if (!s.executed) n++;
  return n;
}

export function selectIsPlanComplete(plan: SubstitutionEvent[]): boolean {
  return plan.length > 0 && selectRemainingCount(plan) === 0;
}

/**
 * Next sub the scheduler would surface given current game state.
 * Returns null when nothing is queued for the current/next half window.
 */
export function selectNextSub(
  plan: SubstitutionEvent[],
  currentHalf: 1 | 2,
  elapsedSeconds: number,
  halfDurationSeconds: number
): SubstitutionEvent | null {
  const remaining = selectRemaining(plan);
  if (remaining.length === 0) return null;
  return (
    findRelevantNextSub(remaining, currentHalf, elapsedSeconds, halfDurationSeconds) ?? null
  );
}

/**
 * Group key for a sub used by EXECUTE / SKIP / CONFIRM_BATCH events.
 * Re-exported so consumers don't have to reach into autoSubHelpers
 * separately from the selectors module.
 */
export { getSubKey };
