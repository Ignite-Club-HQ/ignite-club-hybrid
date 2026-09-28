import { describe, it, expect } from "vitest";
import {
  selectRemaining,
  selectExecuted,
  selectRemainingCount,
  selectIsPlanComplete,
  selectNextSub,
} from "./selectors";
import type { Player, SubstitutionEvent } from "../types";

const mkP = (id: string): Player =>
  ({ id, name: id, position: { x: 0, y: 0 } } as Player);

const mkSub = (
  out: string,
  inn: string,
  half: 1 | 2,
  time: number,
  executed = false,
  skipped = false
): SubstitutionEvent => ({
  time,
  half,
  playerOut: mkP(out),
  playerIn: mkP(inn),
  executed,
  skipped,
});

describe("plan selectors", () => {
  const plan: SubstitutionEvent[] = [
    mkSub("A", "B", 1, 60, true), // executed
    mkSub("C", "D", 1, 120, true, true), // skipped (executed=true)
    mkSub("E", "F", 1, 240, false),
    mkSub("G", "H", 2, 60, false),
  ];

  it("selectRemaining excludes both executed and skipped entries", () => {
    expect(selectRemaining(plan).map((s) => s.playerOut.id)).toEqual(["E", "G"]);
  });

  it("selectExecuted includes both completed and skipped entries", () => {
    expect(selectExecuted(plan).map((s) => s.playerOut.id)).toEqual(["A", "C"]);
  });

  it("selectRemainingCount counts without allocating", () => {
    expect(selectRemainingCount(plan)).toBe(2);
    expect(selectRemainingCount([])).toBe(0);
  });

  it("selectIsPlanComplete is true only when something ran and nothing remains", () => {
    expect(selectIsPlanComplete([])).toBe(false);
    expect(selectIsPlanComplete(plan)).toBe(false);
    const finished = plan.map((s) => ({ ...s, executed: true }));
    expect(selectIsPlanComplete(finished)).toBe(true);
  });

  it("selectNextSub returns the earliest unexecuted sub in current window", () => {
    const next = selectNextSub(plan, 1, 60, 25 * 60);
    expect(next?.playerOut.id).toBe("E");
  });

  it("selectNextSub returns null for an empty/finished plan", () => {
    expect(selectNextSub([], 1, 0, 60)).toBeNull();
    const finished = plan.map((s) => ({ ...s, executed: true }));
    expect(selectNextSub(finished, 1, 60, 60)).toBeNull();
  });
});
