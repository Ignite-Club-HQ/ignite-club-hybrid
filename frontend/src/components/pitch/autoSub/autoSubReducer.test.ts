/**
 * Reducer regression tests — each test corresponds to a historic incident
 * class so they double as named bug-prevention.
 */
import { describe, it, expect } from "vitest";
import {
  autoSubReducer,
  initialAutoSubState,
  type AutoSubState,
  type ReducerContext,
} from "./autoSubReducer";
import type { Player, SubstitutionEvent } from "../types";
import { getSubKey } from "../autoSubHelpers";

// ── Test helpers ────────────────────────────────────────────────────────
const mkPlayer = (id: string, onPitch = true): Player => ({
  id,
  name: id,
  position: onPitch ? { x: 50, y: 50 } : null,
  // Other Player fields are not consulted by the reducer; cast to satisfy TS.
} as Player);

const mkSub = (
  playerOutId: string,
  playerInId: string,
  half: 1 | 2 = 1,
  time = 60
): SubstitutionEvent => ({
  time,
  half,
  playerOut: mkPlayer(playerOutId, true),
  playerIn: mkPlayer(playerInId, false),
});

const ctx = (players: Player[], now = 1_000_000): ReducerContext => ({
  players,
  now,
  skipCooldownMs: 3000,
});

const stateWith = (overrides: Partial<AutoSubState>): AutoSubState => ({
  ...initialAutoSubState,
  ...overrides,
});

// ── Tests ───────────────────────────────────────────────────────────────
describe("autoSubReducer", () => {
  it("START activates with a valid plan", () => {
    const players = [mkPlayer("A"), mkPlayer("B", false)];
    const plan = [mkSub("A", "B")];
    const next = autoSubReducer(initialAutoSubState, { type: "START", plan }, ctx(players));
    expect(next.active).toBe(true);
    expect(next.paused).toBe(false);
    expect(next.plan).toHaveLength(1);
    expect(next.lastError).toBeNull();
  });

  it("START rejects a plan referencing missing players (orphan)", () => {
    const players = [mkPlayer("A")];
    const plan = [mkSub("A", "ghost")];
    const next = autoSubReducer(initialAutoSubState, { type: "START", plan }, ctx(players));
    expect(next.active).toBe(false);
    expect(next.lastError?.code).toBe("orphan-player");
  });

  it("CANCEL clears plan and flags", () => {
    const prev = stateWith({ active: true, plan: [mkSub("A", "B")] });
    const next = autoSubReducer(prev, { type: "CANCEL" }, ctx([mkPlayer("A"), mkPlayer("B", false)]));
    expect(next.active).toBe(false);
    expect(next.plan).toEqual([]);
  });

  it("PAUSE_TOGGLE flips paused only when active", () => {
    const idle = autoSubReducer(initialAutoSubState, { type: "PAUSE_TOGGLE" }, ctx([]));
    expect(idle.paused).toBe(false);

    const active = stateWith({ active: true });
    const paused = autoSubReducer(active, { type: "PAUSE_TOGGLE" }, ctx([]));
    expect(paused.paused).toBe(true);
  });

  it("EXECUTE marks the targeted sub executed", () => {
    const players = [mkPlayer("A"), mkPlayer("B", false)];
    const sub = mkSub("A", "B");
    const prev = stateWith({ active: true, plan: [sub] });
    const next = autoSubReducer(prev, { type: "EXECUTE", subKey: getSubKey(sub) }, ctx(players));
    expect(next.plan[0].executed).toBe(true);
  });

  it("EXECUTE on unknown subKey returns no-such-sub error", () => {
    const next = autoSubReducer(
      stateWith({ active: true }),
      { type: "EXECUTE", subKey: "nope" },
      ctx([])
    );
    expect(next.lastError?.code).toBe("no-such-sub");
  });

  it("SKIP respects cooldown (rejects second skip inside window)", () => {
    const players = [mkPlayer("A"), mkPlayer("B", false), mkPlayer("C"), mkPlayer("D", false)];
    const s1 = mkSub("A", "B", 1, 60);
    const s2 = mkSub("C", "D", 1, 120);
    // lastSkipAt seeded so the first SKIP at now=5000 is past the 3s cooldown.
    const prev = stateWith({ active: true, plan: [s1, s2], lastSkipAt: 0 });

    const after1 = autoSubReducer(prev, { type: "SKIP", subKey: getSubKey(s1) }, ctx(players, 5000));
    expect(after1.plan[0].skipped).toBe(true);
    expect(after1.lastSkipAt).toBe(5000);

    // 500ms later — inside 3s cooldown
    const after2 = autoSubReducer(after1, { type: "SKIP", subKey: getSubKey(s2) }, ctx(players, 5500));
    expect(after2.lastError?.code).toBe("cooldown");
    expect(after2.plan[1].skipped).toBeUndefined();
  });

  it("SKIP after cooldown is accepted", () => {
    const players = [mkPlayer("A"), mkPlayer("B", false), mkPlayer("C"), mkPlayer("D", false)];
    const s1 = mkSub("A", "B");
    const s2 = mkSub("C", "D", 1, 120);
    const prev = stateWith({ active: true, plan: [s1, s2], lastSkipAt: 1000 });
    const next = autoSubReducer(prev, { type: "SKIP", subKey: getSubKey(s2) }, ctx(players, 5000));
    expect(next.plan[1].skipped).toBe(true);
    expect(next.lastError).toBeNull();
  });

  it("REPLACE_REMAINING preserves executed entries (manual sub preservation)", () => {
    // Historic bug: a repair pass wiped a user-edited plan because it
    // recomputed the entire plan instead of only the remaining tail.
    const players = [
      mkPlayer("A"), mkPlayer("B", false),
      mkPlayer("C"), mkPlayer("D", false),
      mkPlayer("E"), mkPlayer("F", false),
    ];
    const executedSub = { ...mkSub("A", "B", 1, 60), executed: true };
    const userEditedRemaining = mkSub("C", "D", 1, 180); // user manually added
    const planBefore = [executedSub, userEditedRemaining];

    // Repair pass produces a different remaining tail.
    const repairOutput = [mkSub("E", "F", 1, 240)];
    const next = autoSubReducer(
      stateWith({ active: true, plan: planBefore }),
      { type: "REPLACE_REMAINING", remaining: repairOutput, reason: "repair" },
      ctx(players)
    );
    // Executed sub must still be there exactly as it was.
    expect(next.plan[0]).toEqual(executedSub);
    // Remaining tail is the repair output (not the user-edited one we threw away on purpose).
    expect(next.plan.slice(1)).toEqual(repairOutput);
  });

  it("REPLACE_REMAINING rejects a remaining tail that collides with an executed entry", () => {
    const players = [mkPlayer("A"), mkPlayer("B", false)];
    const executedSub = { ...mkSub("A", "B"), executed: true };
    const prev = stateWith({ active: true, plan: [executedSub] });
    // Caller's `remaining` accidentally re-includes the same sub key as
    // pending. Reducer concatenates executed + remaining → duplicate key.
    const next = autoSubReducer(
      prev,
      { type: "REPLACE_REMAINING", remaining: [{ ...executedSub, executed: false }], reason: "repair" },
      ctx(players)
    );
    expect(next.lastError?.code).toBe("duplicate-sub");
    // Original plan is preserved on reject.
    expect(next.plan).toEqual([executedSub]);
  });

  it("LOCK_TOGGLE rejects if a remaining sub already targets the locked player", () => {
    const players = [mkPlayer("A"), mkPlayer("B", false)];
    const sub = mkSub("A", "B");
    const prev = stateWith({ active: true, plan: [sub] });
    const next = autoSubReducer(prev, { type: "LOCK_TOGGLE", playerId: "A" }, ctx(players));
    expect(next.lastError?.code).toBe("locked-player");
    expect(next.lockedIds.has("A")).toBe(false);
  });

  it("LOCK_TOGGLE accepts when no remaining sub targets the player", () => {
    const players = [mkPlayer("A"), mkPlayer("B", false)];
    const prev = stateWith({ active: true, plan: [] });
    const next = autoSubReducer(prev, { type: "LOCK_TOGGLE", playerId: "A" }, ctx(players));
    expect(next.lockedIds.has("A")).toBe(true);
    expect(next.lastError).toBeNull();
  });

  it("CONFIRM_BATCH marks all targeted subs executed", () => {
    const players = [
      mkPlayer("A"), mkPlayer("B", false),
      mkPlayer("C"), mkPlayer("D", false),
    ];
    const s1 = mkSub("A", "B");
    const s2 = mkSub("C", "D", 1, 120);
    const prev = stateWith({ active: true, plan: [s1, s2] });
    const next = autoSubReducer(
      prev,
      { type: "CONFIRM_BATCH", subKeys: [getSubKey(s1), getSubKey(s2)] },
      ctx(players)
    );
    expect(next.plan.every((s) => s.executed)).toBe(true);
    expect(next.pendingConfirm).toBeNull();
    expect(next.pendingBatch).toEqual([]);
  });

  it("TICK is a no-op (selectors derive next/due)", () => {
    const prev = stateWith({ active: true });
    const next = autoSubReducer(prev, { type: "TICK", elapsed: 100, half: 1 }, ctx([]));
    expect(next).toBe(prev);
  });
});
