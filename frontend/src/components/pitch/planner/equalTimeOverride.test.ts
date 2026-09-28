import { describe, expect, it } from "vitest";
import type { PlannerPlayer, PlannerSubstitutionEvent } from "./analysis";
import {
  buildEqualTimeOverride,
  calculatePlanSpread,
  calculatePlanTotals,
  rebalanceablePlayers,
} from "./equalTimeOverride";

const starter = (id: string, position: "GK" | "DEF" | "MID" | "FWD" = "MID"): PlannerPlayer => ({
  id,
  name: id,
  position: { x: 50, y: 50 },
  currentPitchPosition: position,
  assignedPositions: [position],
});
const bench = (id: string): PlannerPlayer => ({
  id,
  name: id,
  position: null,
  assignedPositions: ["MID"],
});
const event = (
  playerOut: PlannerPlayer,
  playerIn: PlannerPlayer,
  time: number,
  half: 1 | 2 = 1,
): PlannerSubstitutionEvent => ({ playerOut, playerIn, time, half });

const thresholds = {
  standardTargetInterval: 420,
  standardIntervalFloor: 240,
  frequentIntervalFloor: 180,
  minShiftSeconds: 180,
};

describe("equal-time override boundary", () => {
  it("calculates exact plan totals including minutes already banked", () => {
    const first = { ...starter("first"), minutesPlayed: 60 };
    const second = bench("second");
    const totals = calculatePlanTotals(
      [first, second],
      [event(first, second, 300)],
      600,
    );
    expect(Object.fromEntries(totals)).toEqual({ first: 360, second: 900 });
  });

  it("excludes injured and full-match goalkeeper-only players from controllable spread", () => {
    const goalkeeper = starter("goalkeeper", "GK");
    const field = starter("field");
    const reserve = bench("reserve");
    const injured = { ...bench("injured"), isInjured: true };

    expect(rebalanceablePlayers([goalkeeper, field, reserve, injured], false)
      .map(({ id }) => id)).toEqual(["field", "reserve"]);
    expect(rebalanceablePlayers([goalkeeper, field, reserve, injured], true)
      .map(({ id }) => id)).toEqual(["goalkeeper", "field", "reserve"]);
  });

  it("measures spread only across players the planner can rebalance", () => {
    const goalkeeper = starter("goalkeeper", "GK");
    const field = starter("field");
    const reserve = bench("reserve");
    const plan = [event(field, reserve, 600)];

    expect(calculatePlanSpread([goalkeeper, field, reserve], plan, 600, false)).toBe(0);
    expect(calculatePlanSpread([goalkeeper, field, reserve], plan, 600, true)).toBe(600);
  });

  it("does not override a coach priority, mid-game plan or roster without a bench", () => {
    const players = [starter("one"), starter("two")];
    const base = {
      playerData: players,
      teamSize: 2,
      halfDurationSeconds: 600,
      gkOnPitch: undefined,
      halftimeGkIn: undefined,
      rotateGkAtHalftime: false,
      maxSpreadMinutes: 5,
      rotationSpeed: 1,
      eff: thresholds,
      priorityOrderLength: 0,
      startHalf: 1 as const,
      startElapsedSeconds: 0,
      benchCount: 0,
      currentPlan: [] as PlannerSubstitutionEvent[],
    };

    expect(buildEqualTimeOverride(base)).toBeNull();
    expect(buildEqualTimeOverride({ ...base, benchCount: 1, priorityOrderLength: 1 }))
      .toBeNull();
    expect(buildEqualTimeOverride({
      ...base,
      benchCount: 1,
      priorityOrderLength: 0,
      startHalf: 2,
    })).toBeNull();
  });

  it("generates deterministic Standard equal-time candidates from kickoff", () => {
    const players = [
      starter("one", "DEF"),
      starter("two", "MID"),
      starter("three", "MID"),
      starter("four", "FWD"),
      bench("five"),
    ];
    const options = {
      playerData: players,
      teamSize: 4,
      halfDurationSeconds: 1_200,
      gkOnPitch: undefined,
      halftimeGkIn: undefined,
      rotateGkAtHalftime: false,
      maxSpreadMinutes: 5,
      rotationSpeed: 1,
      eff: thresholds,
      priorityOrderLength: 0,
      startHalf: 1 as const,
      startElapsedSeconds: 0,
      benchCount: 1,
      currentPlan: [] as PlannerSubstitutionEvent[],
    };
    const signature = (plan: PlannerSubstitutionEvent[] | null) => plan?.map((substitution) =>
      `${substitution.half}:${substitution.time}:${substitution.playerOut.id}>${substitution.playerIn.id}`);

    const first = buildEqualTimeOverride(options);
    const second = buildEqualTimeOverride(options);
    expect(first).not.toBeNull();
    expect(signature(second)).toEqual(signature(first));
    expect(calculatePlanSpread(players, first!, 1_200, false)).toBeLessThan(
      calculatePlanSpread(players, [], 1_200, false),
    );
  });
});
