/**
 * Plan validator.
 *
 * Asserts the invariants the auto-sub state machine relies on. Called by
 * `autoSubReducer` before any transition that produces a new plan.
 *
 * Two flavours:
 *  - `validatePlanIntegrity` — duplicates, executed-immutable, locked-player.
 *    Cheap, always safe to run, never produces false positives mid-transition.
 *    Used by every reducer event including legacy SET_PLAN compat.
 *  - `validatePlanRoster` — additionally checks every remaining sub references
 *    a player still on the roster. Reserved for events with a guaranteed-fresh
 *    roster snapshot (START). Other paths defer orphan detection to
 *    `usePitchBoardPlanRepair`'s explicit orphan-cancel effect.
 *
 * `assertValidPlan` runs both for back-compat with existing tests.
 */
import type { Player, SubstitutionEvent } from "../types";
import { getSubKey } from "../autoSubHelpers";
import type { PlanError } from "./planEvents";

export interface ValidatePlanCtx {
  players: Player[];
  /** Previous plan to compare `executed` entries against (immutability check). */
  previousPlan?: SubstitutionEvent[];
  /** Currently locked player ids; remaining subs must not sub these players off. */
  lockedIds?: Set<string>;
}

export function validatePlanIntegrity(
  plan: SubstitutionEvent[],
  ctx: Pick<ValidatePlanCtx, "previousPlan" | "lockedIds">
): PlanError | null {
  const { previousPlan, lockedIds } = ctx;

  // ── 1. Duplicate sub keys ──
  const seen = new Set<string>();
  for (const sub of plan) {
    const key = getSubKey(sub);
    if (seen.has(key)) {
      return { code: "duplicate-sub", message: `Duplicate sub ${key} in plan` };
    }
    seen.add(key);
  }

  // ── 2. Executed entries are append-only ──
  if (previousPlan) {
    for (const prev of previousPlan) {
      if (!prev.executed) continue;
      const key = getSubKey(prev);
      const match = plan.find((s) => getSubKey(s) === key);
      if (!match) {
        return { code: "mutated-executed", message: `Executed sub ${key} was removed from plan` };
      }
      if (!match.executed) {
        return { code: "mutated-executed", message: `Executed sub ${key} was reverted to pending` };
      }
    }
  }

  // ── 3. Locked players are never subbed off in remaining entries ──
  if (lockedIds && lockedIds.size > 0) {
    for (const sub of plan) {
      if (sub.executed) continue;
      if (lockedIds.has(sub.playerOut.id)) {
        return {
          code: "locked-player",
          message: `Remaining sub ${getSubKey(sub)} would sub off locked player ${sub.playerOut.id}`,
        };
      }
    }
  }

  return null;
}

export function validatePlanRoster(
  plan: SubstitutionEvent[],
  players: Player[]
): PlanError | null {
  const playerIds = new Set(players.map((p) => p.id));
  for (const sub of plan) {
    if (sub.executed) continue;
    if (!playerIds.has(sub.playerIn.id) || !playerIds.has(sub.playerOut.id)) {
      return {
        code: "orphan-player",
        message: `Sub ${getSubKey(sub)} references a player no longer on the roster`,
      };
    }
  }
  return null;
}

export function assertValidPlan(
  plan: SubstitutionEvent[],
  ctx: ValidatePlanCtx
): PlanError | null {
  return (
    validatePlanIntegrity(plan, ctx) ?? validatePlanRoster(plan, ctx.players)
  );
}
