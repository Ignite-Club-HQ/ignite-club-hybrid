/**
 * Plan repair — pure functions producing repair intentions.
 *
 * The two repair flows that historically lived inline in
 * `usePitchBoardPlanRepair` (composition-change repair and injury recalc)
 * both end up doing one of four things:
 *
 *   1. cancel       — a referenced player is gone, plan is unsalvageable
 *   2. regenerate   — repair emptied the remaining plan but bench is healthy
 *   3. replace      — splice fresh remaining[] in, keep executed[] verbatim
 *   4. noop         — nothing to do
 *
 * Returning intentions (not React state writes) means:
 *   • the same logic is unit-testable
 *   • the caller decides which event to dispatch (REPLACE_REMAINING / CANCEL)
 *   • toast + regenerate side-effects stay in the React layer
 */
import type { Player, SubstitutionEvent } from "../types";
import {
  recalculateRemainingPlanTeamAware as recalculateRemainingPlan,
  validateAndFixRemainingPlan,
} from "../pitchStateUtils";

export type RepairIntent =
  | { kind: "noop" }
  | { kind: "cancel"; reason: "orphan-player" }
  | { kind: "regenerate"; reason: "empty-after-repair" }
  | {
      kind: "replace";
      remaining: SubstitutionEvent[];
      executed: SubstitutionEvent[];
      reason: "composition-changed" | "injury";
      injuryFallback?: boolean;
    };

/**
 * Detect orphaned references (player no longer in roster).
 */
export function findOrphanedReferences(
  plan: SubstitutionEvent[],
  players: Player[]
): boolean {
  const ids = new Set(players.map((p) => p.id));
  return plan
    .filter((s) => !s.executed)
    .some((s) => !ids.has(s.playerIn.id) || !ids.has(s.playerOut.id));
}

/**
 * Composition-change repair: when on-pitch composition shifts (manual swap,
 * injury sub, etc.), mark already-completed manual swaps as executed and
 * re-validate the remaining schedule against the live roster.
 *
 * This is the same algorithm that previously lived inline in
 * `usePitchBoardPlanRepair`'s effect.
 */
export function repairForComposition(
  plan: SubstitutionEvent[],
  players: Player[]
): RepairIntent {
  if (plan.length === 0) return { kind: "noop" };

  const remaining = plan.filter((s) => !s.executed);
  if (remaining.length === 0) return { kind: "noop" };

  const benchIds = new Set(
    players.filter((p) => p.position === null).map((p) => p.id)
  );
  const pitchIds = new Set(
    players.filter((p) => p.position !== null).map((p) => p.id)
  );
  const matchedKeys = new Set<string>();
  const claimedPairs = new Set<string>();

  // Sort earliest-first so we settle ambiguous matches in time order.
  const remainingSorted = [...remaining].sort((a, b) => {
    const at = a.half === 1 ? a.time : 100000 + a.time;
    const bt = b.half === 1 ? b.time : 100000 + b.time;
    return at - bt;
  });
  remainingSorted.forEach((s) => {
    const pairKey = `${s.playerOut.id}->${s.playerIn.id}`;
    if (claimedPairs.has(pairKey)) return;
    if (benchIds.has(s.playerOut.id) && pitchIds.has(s.playerIn.id)) {
      matchedKeys.add(`${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`);
      claimedPairs.add(pairKey);
    }
  });

  const repaired = validateAndFixRemainingPlan(
    plan.map((s) => {
      const k = `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`;
      return matchedKeys.has(k) ? { ...s, executed: true } : s;
    }),
    players
  );

  const remainingAfter = repaired.filter((s) => !s.executed);
  const executedAfter = repaired.filter((s) => s.executed);
  const benchAvailable = players.filter(
    (p) => p.position === null && !p.isInjured
  );

  if (remainingAfter.length === 0 && benchAvailable.length > 0) {
    return { kind: "regenerate", reason: "empty-after-repair" };
  }

  return {
    kind: "replace",
    executed: executedAfter,
    remaining: remainingAfter,
    reason: "composition-changed",
  };
}

export interface InjuryRepairArgs {
  plan: SubstitutionEvent[];
  updatedPlayers: Player[];
  injuredId: string;
  replacementId?: string;
  teamSize: number;
  minutesPerHalfSecs: number;
  currentElapsed: number;
  currentHalf: 1 | 2;
  rotateGkAtHalftime: boolean;
}

/**
 * Injury recalculation: same logic as the prior `recalcPlanForInjury` but
 * pure — returns an intent rather than calling setAutoSubPlan + toast.
 */
export function repairForInjury(args: InjuryRepairArgs): RepairIntent {
  const {
    plan,
    updatedPlayers,
    injuredId,
    replacementId,
    teamSize,
    minutesPerHalfSecs,
    currentElapsed,
    currentHalf,
    rotateGkAtHalftime,
  } = args;

  if (!plan.some((s) => !s.executed)) return { kind: "noop" };

  const executedSubs = plan.filter((s) => s.executed);
  const remainingSubs = plan.filter((s) => !s.executed);

  const anchor =
    remainingSubs.find(
      (sub) =>
        sub.playerIn.id === injuredId ||
        sub.playerOut.id === injuredId ||
        (replacementId &&
          (sub.playerIn.id === replacementId ||
            sub.playerOut.id === replacementId))
    ) || remainingSubs[0];

  const recalculated = recalculateRemainingPlan(
    updatedPlayers,
    teamSize,
    minutesPerHalfSecs,
    currentElapsed,
    currentHalf,
    anchor,
    rotateGkAtHalftime
  );

  if (recalculated.length > 0 || remainingSubs.length === 0) {
    return {
      kind: "replace",
      executed: executedSubs,
      remaining: recalculated,
      reason: "injury",
    };
  }

  const benchPlayers = updatedPlayers.filter(
    (p) => p.position === null && !p.isInjured
  );
  if (benchPlayers.length > 0) {
    // Recalc collapsed unexpectedly — strip the injured player's pending
    // subs but keep everything else intact.
    return {
      kind: "replace",
      executed: executedSubs,
      remaining: remainingSubs.filter(
        (s) => s.playerIn.id !== injuredId && s.playerOut.id !== injuredId
      ),
      reason: "injury",
      injuryFallback: true,
    };
  }

  return {
    kind: "replace",
    executed: executedSubs,
    remaining: recalculated,
    reason: "injury",
  };
}
