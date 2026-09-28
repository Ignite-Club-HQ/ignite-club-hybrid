import { describe, expect, it } from "vitest";
import {
  calculateFairnessReport,
  calculateTimeForecasts,
  inferredOutfieldPosition,
  inferredPitchPosition,
  normalizeRotationSpeed,
  type PlannerPlayer,
  type PlannerSubstitutionEvent,
} from "./analysis";

const starter = (id: string, currentPitchPosition: "GK" | "DEF" | "MID" | "FWD" = "MID"): PlannerPlayer => ({
  id,
  name: id,
  position: { x: 50, y: 50 },
  currentPitchPosition,
});

const bench = (id: string, assignedPositions: ("GK" | "DEF" | "MID" | "FWD")[] = ["MID"]): PlannerPlayer => ({
  id,
  name: id,
  position: null,
  assignedPositions,
});

const substitution = (
  playerOut: PlannerPlayer,
  playerIn: PlannerPlayer,
  time: number,
  half: 1 | 2 = 1,
): PlannerSubstitutionEvent => ({ playerOut, playerIn, time, half });

describe("AutoSub pure analysis boundaries", () => {
  it("preserves the two public rotation modes and folds legacy values into Frequent", () => {
    expect([null, undefined, -1, 0, 1, 1.9, 2, 3, Number.NaN].map(normalizeRotationSpeed))
      .toEqual([1, 1, 1, 1, 1, 1, 2, 2, 1]);
  });

  it("infers goalkeeper-only and outfield fallback positions without mutating a player", () => {
    const goalkeeper = bench("gk", ["GK"]);
    const mixed = { ...bench("mixed", ["GK", "DEF"]), currentPitchPosition: undefined };

    expect(inferredPitchPosition(goalkeeper)).toBe("GK");
    expect(inferredOutfieldPosition(mixed)).toBe("DEF");
    expect(inferredPitchPosition({ ...mixed, currentPitchPosition: "FWD" })).toBe("FWD");
  });

  it("forecasts one exact substitution across the complete match", () => {
    const onPitch = starter("starter");
    const onBench = bench("bench");
    const forecasts = calculateTimeForecasts(
      [onPitch, onBench],
      [substitution(onPitch, onBench, 10 * 60)],
      20,
    );

    expect(forecasts.map(({ player, predictedMinutes, percentageOfGame }) => ({
      id: player.id,
      predictedMinutes,
      percentageOfGame,
    }))).toEqual([
      { id: "bench", predictedMinutes: 30, percentageOfGame: 75 },
      { id: "starter", predictedMinutes: 10, percentageOfGame: 25 },
    ]);
  });

  it("ignores executed, skipped and already elapsed plan events", () => {
    const first = starter("first");
    const second = bench("second");
    const events: PlannerSubstitutionEvent[] = [
      { ...substitution(first, second, 60), executed: true },
      { ...substitution(first, second, 120), skipped: true },
      substitution(first, second, 5 * 60),
    ];

    const forecasts = calculateTimeForecasts([first, second], events, 10, undefined, true, 1, 6 * 60);
    expect(forecasts.map(({ player, predictedMinutes }) => [player.id, predictedMinutes]))
      .toEqual([["first", 14], ["second", 0]]);
  });

  it("reports halftime goalkeeper roles using the preferred second-half keeper", () => {
    const goalkeeper = starter("gk", "GK");
    const replacement = bench("replacement", ["GK", "MID"]);
    const forecasts = calculateTimeForecasts(
      [goalkeeper, replacement],
      [],
      20,
      replacement.id,
      true,
    );

    expect(Object.fromEntries(forecasts.map(({ player, gkRole }) => [player.id, gkRole])))
      .toEqual({ gk: "1h", replacement: "2h" });
  });

  it("calculates exact stint totals, spread and grade", () => {
    const first = starter("first");
    const second = bench("second");
    const report = calculateFairnessReport(
      [first, second],
      [substitution(first, second, 5 * 60)],
      10,
    );

    expect(report).toMatchObject({
      minSeconds: 5 * 60,
      maxSeconds: 15 * 60,
      avgSeconds: 10 * 60,
      spreadSeconds: 10 * 60,
      totalSubs: 1,
      grade: "fair",
    });
    expect(report.perPlayer.map(({ playerId, totalSeconds }) => [playerId, totalSeconds]))
      .toEqual([["second", 15 * 60], ["first", 5 * 60]]);
  });

  it("does not apply a skipped substitution to stint totals", () => {
    const first = starter("first");
    const second = bench("second");
    const report = calculateFairnessReport(
      [first, second],
      [{ ...substitution(first, second, 60), skipped: true }],
      10,
    );

    expect(report.perPlayer.map(({ playerId, totalSeconds }) => [playerId, totalSeconds]))
      .toEqual([["first", 20 * 60], ["second", 0]]);
    expect(report.totalSubs).toBe(1);
  });
});
