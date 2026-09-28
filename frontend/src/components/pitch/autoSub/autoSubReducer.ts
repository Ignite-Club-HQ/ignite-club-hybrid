/**
 * Auto-sub reducer — pure state machine for the auto-sub plan.
 *
 * The ONLY place that mutates plan state. Callers dispatch events from
 * `planEvents.ts`; the reducer validates them via `assertValidPlan` and
 * returns either a new state or rejects the transition with a typed error.
 *
 * No React, no toasts, no timers, no side effects. Easy to unit-test.
 */
import type { SubstitutionEvent, Player } from "../types";
import { getSubKey } from "../autoSubHelpers";
import { assertValidPlan, validatePlanIntegrity } from "./assertValidPlan";
import type { PlanError, PlanEvent } from "./planEvents";

export interface AutoSubState {
  plan: SubstitutionEvent[];
  active: boolean;
  paused: boolean;
  lockedIds: Set<string>;
  /** Single sub currently awaiting confirmation in the dialog. */
  pendingConfirm: SubstitutionEvent | null;
  /** Batched group of subs queued behind `pendingConfirm`. */
  pendingBatch: SubstitutionEvent[];
  /** Epoch ms of last accepted SKIP, used to enforce cooldown. */
  lastSkipAt: number;
  /** Last validator error, surfaced for UI toasts via React effects. */
  lastError: PlanError | null;
}

export interface ReducerContext {
  players: Player[];
  /** Epoch ms. Inject for testability. */
  now: number;
  /** Minimum ms between SKIP events. */
  skipCooldownMs?: number;
}

const DEFAULT_SKIP_COOLDOWN_MS = 3000;

export const initialAutoSubState: AutoSubState = {
  plan: [],
  active: false,
  paused: false,
  lockedIds: new Set(),
  pendingConfirm: null,
  pendingBatch: [],
  lastSkipAt: 0,
  lastError: null,
};

export function autoSubReducer(
  state: AutoSubState,
  ev: PlanEvent,
  ctx: ReducerContext
): AutoSubState {
  const reject = (err: PlanError): AutoSubState => ({ ...state, lastError: err });
  const accept = (next: Partial<AutoSubState>): AutoSubState => ({
    ...state,
    ...next,
    lastError: null,
  });

  switch (ev.type) {
    case "START": {
      const err = assertValidPlan(ev.plan, { players: ctx.players });
      if (err) return reject(err);
      return accept({
        plan: ev.plan,
        active: true,
        paused: false,
        pendingConfirm: null,
        pendingBatch: [],
      });
    }

    case "CANCEL": {
      return accept({
        plan: [],
        active: false,
        paused: false,
        pendingConfirm: null,
        pendingBatch: [],
      });
    }

    case "PAUSE_TOGGLE": {
      if (!state.active) return state;
      return accept({ paused: !state.paused });
    }

    case "LOCK_TOGGLE": {
      const lockedIds = new Set(state.lockedIds);
      if (lockedIds.has(ev.playerId)) lockedIds.delete(ev.playerId);
      else lockedIds.add(ev.playerId);
      // Validate: a remaining sub may already target this player — reject so caller can resolve.
      const err = assertValidPlan(state.plan, {
        players: ctx.players,
        previousPlan: state.plan,
        lockedIds,
      });
      if (err) return reject(err);
      return accept({ lockedIds });
    }

    case "EXECUTE": {
      const idx = state.plan.findIndex((s) => getSubKey(s) === ev.subKey);
      if (idx < 0) return reject({ code: "no-such-sub", message: ev.subKey });
      const sub = state.plan[idx];
      if (sub.executed) return state;
      const nextPlan = state.plan.map((s, i) =>
        i === idx ? { ...s, executed: true } : s
      );
      const err = assertValidPlan(nextPlan, {
        players: ctx.players,
        previousPlan: state.plan,
        lockedIds: state.lockedIds,
      });
      if (err) return reject(err);
      return accept({ plan: nextPlan });
    }

    case "CONFIRM_BATCH": {
      const keys = new Set(ev.subKeys);
      const nextPlan = state.plan.map((s) =>
        keys.has(getSubKey(s)) && !s.executed ? { ...s, executed: true } : s
      );
      const err = assertValidPlan(nextPlan, {
        players: ctx.players,
        previousPlan: state.plan,
        lockedIds: state.lockedIds,
      });
      if (err) return reject(err);
      return accept({ plan: nextPlan, pendingConfirm: null, pendingBatch: [] });
    }

    case "SKIP": {
      const cooldown = ctx.skipCooldownMs ?? DEFAULT_SKIP_COOLDOWN_MS;
      if (ctx.now - state.lastSkipAt < cooldown) {
        return reject({
          code: "cooldown",
          message: `Skip cooldown active (${cooldown}ms)`,
        });
      }
      const idx = state.plan.findIndex((s) => getSubKey(s) === ev.subKey);
      if (idx < 0) return reject({ code: "no-such-sub", message: ev.subKey });
      const sub = state.plan[idx];
      if (sub.executed) return state;
      const nextPlan = state.plan.map((s, i) =>
        i === idx ? { ...s, executed: true, skipped: true } : s
      );
      const err = assertValidPlan(nextPlan, {
        players: ctx.players,
        previousPlan: state.plan,
        lockedIds: state.lockedIds,
      });
      if (err) return reject(err);
      return accept({ plan: nextPlan, lastSkipAt: ctx.now });
    }

    case "REPLACE_REMAINING": {
      // Preserve executed entries verbatim, splice in caller-provided remaining.
      const executed = state.plan.filter((s) => s.executed);
      const remaining = ev.remaining.filter((s) => !s.executed);
      const nextPlan = [...executed, ...remaining];
      const err = assertValidPlan(nextPlan, {
        players: ctx.players,
        previousPlan: state.plan,
        lockedIds: state.lockedIds,
      });
      if (err) return reject(err);
      return accept({ plan: nextPlan });
    }

    case "TICK": {
      // Tick is a no-op at the reducer level today. Selectors compute
      // due/next from (plan, elapsed, half). Kept in the event union so the
      // scheduler hook has a single dispatch surface and we can later
      // attach due-highlight derivations here without touching call sites.
      return state;
    }

    // ── Step B legacy compat ───────────────────────────────────────────
    case "SET_PLAN": {
      // Integrity check only: legacy callers compute the full plan
      // (executed + remaining) and may race ahead of player updates.
      // Orphan detection is handled separately by usePitchBoardPlanRepair.
      const err = validatePlanIntegrity(ev.plan, {
        previousPlan: state.plan,
        lockedIds: state.lockedIds,
      });
      if (err) return reject(err);
      return accept({ plan: ev.plan });
    }

    case "SET_ACTIVE": {
      return accept({ active: ev.active });
    }

    case "SET_PAUSED": {
      return accept({ paused: ev.paused });
    }

    default: {
      const _exhaustive: never = ev;
      void _exhaustive;
      return state;
    }
  }
}
