/**
 * Auto-sub debug event recorder.
 *
 * Bounded ring buffer of the last N reducer dispatches. Captures the event,
 * before/after plan snapshot, summary deltas, and any validator rejection.
 *
 * Always on (cheap: bounded array, structuredClone of small objects). Inspect
 * in the browser console via `window.__autoSubLog()` or
 * `window.__autoSubLog.clear()`.
 */
import type { SubstitutionEvent } from "../types";
import type { AutoSubState } from "./autoSubReducer";
import type { PlanError, PlanEvent } from "./planEvents";
import { getSubKey } from "../autoSubHelpers";

export interface AutoSubLogEntry {
  /** Epoch ms. */
  at: number;
  /** ISO timestamp, for human reading in console. */
  ts: string;
  event: PlanEvent;
  /** True when reducer returned a `lastError` (transition rejected). */
  rejected: boolean;
  error: PlanError | null;
  prev: {
    active: boolean;
    paused: boolean;
    planLength: number;
    remaining: number;
    executed: number;
    lockedCount: number;
    keys: string[];
  };
  next: {
    active: boolean;
    paused: boolean;
    planLength: number;
    remaining: number;
    executed: number;
    lockedCount: number;
    keys: string[];
  };
  /** Sub keys added vs removed vs newly-executed. */
  diff: {
    added: string[];
    removed: string[];
    executed: string[];
  };
}

const MAX_ENTRIES = 100;
const buffer: AutoSubLogEntry[] = [];

function snapshot(state: AutoSubState) {
  const plan = state.plan;
  const keys = plan.map(getSubKey);
  let executed = 0;
  for (const s of plan) if (s.executed) executed++;
  return {
    active: state.active,
    paused: state.paused,
    planLength: plan.length,
    remaining: plan.length - executed,
    executed,
    lockedCount: state.lockedIds.size,
    keys,
  };
}

function diffPlans(prev: SubstitutionEvent[], next: SubstitutionEvent[]) {
  const prevKeys = new Set(prev.map(getSubKey));
  const nextKeys = new Set(next.map(getSubKey));
  const prevExecuted = new Set(
    prev.filter((s) => s.executed).map(getSubKey)
  );
  const added: string[] = [];
  const removed: string[] = [];
  const executed: string[] = [];
  for (const k of nextKeys) if (!prevKeys.has(k)) added.push(k);
  for (const k of prevKeys) if (!nextKeys.has(k)) removed.push(k);
  for (const s of next) {
    const k = getSubKey(s);
    if (s.executed && !prevExecuted.has(k)) executed.push(k);
  }
  return { added, removed, executed };
}

export function recordAutoSubTransition(
  event: PlanEvent,
  prevState: AutoSubState,
  nextState: AutoSubState
): void {
  const rejected =
    nextState.lastError !== null && nextState.lastError !== prevState.lastError;
  const entry: AutoSubLogEntry = {
    at: Date.now(),
    ts: new Date().toISOString(),
    event,
    rejected,
    error: rejected ? nextState.lastError : null,
    prev: snapshot(prevState),
    next: snapshot(nextState),
    diff: diffPlans(prevState.plan, nextState.plan),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function getAutoSubLog(): AutoSubLogEntry[] {
  return buffer.slice();
}

export function clearAutoSubLog(): void {
  buffer.length = 0;
}

/** Pretty-print the log to console as a table summary + full JSON. */
export function printAutoSubLog(): AutoSubLogEntry[] {
  const rows = buffer.map((e) => ({
    ts: e.ts.slice(11, 23),
    event: e.event.type,
    rejected: e.rejected,
    err: e.error?.code ?? "",
    planLen: `${e.prev.planLength}→${e.next.planLength}`,
    remaining: `${e.prev.remaining}→${e.next.remaining}`,
    executed: `${e.prev.executed}→${e.next.executed}`,
    added: e.diff.added.length,
    removed: e.diff.removed.length,
    newlyExecuted: e.diff.executed.length,
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
  return buffer.slice();
}

// Expose to window for live debugging.
if (typeof window !== "undefined") {
  const fn = printAutoSubLog as typeof printAutoSubLog & {
    clear: typeof clearAutoSubLog;
    raw: typeof getAutoSubLog;
  };
  fn.clear = clearAutoSubLog;
  fn.raw = getAutoSubLog;
  (window as unknown as { __autoSubLog: typeof fn }).__autoSubLog = fn;
}
