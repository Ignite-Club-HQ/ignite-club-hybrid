import { describe, expect, it, vi } from "vitest";
import type { PlannerPlayer, PlannerSubstitutionEvent } from "./analysis";
import {
  STANDARD_CALMDOWN_FLOORS_SECONDS,
  compactOneStandardWindow,
  countSubstitutionWindows,
  ensureNoStarvedPlayers,
  resolvePlannerThresholds,
  substitutionAbsoluteTime,
} from "./standardMode";

const player = (id: string, starts = false): PlannerPlayer => ({
  id,
  name: id,
  position: starts ? { x: 50, y: 50 } : null,
});

const a = player("a", true);
const b = player("b");
const c = player("c", true);
const d = player("d");

const event = (
  playerOut: PlannerPlayer,
  playerIn: PlannerPlayer,
  time: number,
  half: 1 | 2 = 1,
): PlannerSubstitutionEvent => ({ playerOut, playerIn, time, half });

describe("Standard-mode cadence boundary", () => {
  it("maps second-half times onto the absolute match timeline", () => {
    expect(substitutionAbsoluteTime(event(a, b, 90, 1), 1_200)).toBe(90);
    expect(substitutionAbsoluteTime(event(a, b, 90, 2), 1_200)).toBe(1_290);
  });

  it("counts whistle windows rather than individual player movements", () => {
    const plan = [
      event(a, b, 300),
      event(c, d, 300),
      event(b, a, 600),
      event(d, c, 0, 2),
    ];
    expect(countSubstitutionWindows(plan, 600)).toBe(2);
  });

  it("retains the ordered calm-down cadence candidates", () => {
    expect(STANDARD_CALMDOWN_FLOORS_SECONDS).toEqual([300, 360, 420, 480, 540, 600]);
  });

  it("resolves the established regular and one-bench timing thresholds", () => {
    expect(resolvePlannerThresholds(2)).toEqual({
      standardTargetInterval: 420,
      standardIntervalFloor: 240,
      frequentIntervalFloor: 180,
      minShiftSeconds: 180,
      halftimeGuardSeconds: undefined,
    });
    expect(resolvePlannerThresholds(1)).toEqual({
      standardTargetInterval: 240,
      standardIntervalFloor: 180,
      frequentIntervalFloor: 120,
      minShiftSeconds: 150,
      halftimeGuardSeconds: undefined,
    });
  });

  it("clamps advanced timing overrides to the existing safe ranges", () => {
    expect(resolvePlannerThresholds(3, {
      standardTargetIntervalSec: 2_000,
      standardIntervalFloorSec: 1,
      frequentIntervalFloorSec: 999,
      minShiftSeconds: -10,
      halftimeGuardSeconds: 999,
    })).toEqual({
      standardTargetInterval: 900,
      standardIntervalFloor: 120,
      frequentIntervalFloor: 420,
      minShiftSeconds: 60,
      halftimeGuardSeconds: 420,
    });
  });

  it("rewires an over-served incoming turn to rescue a healthy starved player", () => {
    const starved = player("starved");
    const source = [event(a, b, 300), event(b, a, 600)];
    const result = ensureNoStarvedPlayers(source, [a, b, starved], 600);

    expect(result).toBe(source);
    expect(result.map(({ playerOut, playerIn, time }) => ({
      out: playerOut.id,
      in: playerIn.id,
      time,
    }))).toEqual([
      { out: "a", in: "b", time: 300 },
      { out: "b", in: "starved", time: 600 },
    ]);
  });

  it("does not force injured or goalkeeper-only bench players into the rotation", () => {
    const injured = { ...player("injured"), isInjured: true };
    const goalkeeper = { ...player("goalkeeper"), assignedPositions: ["GK" as const] };
    const source = [event(a, b, 300), event(b, a, 600)];
    const signature = source.map(({ playerOut, playerIn, time }) =>
      `${time}:${playerOut.id}>${playerIn.id}`);

    ensureNoStarvedPlayers(source, [a, b, injured, goalkeeper], 600);
    expect(source.map(({ playerOut, playerIn, time }) =>
      `${time}:${playerOut.id}>${playerIn.id}`)).toEqual(signature);
  });

  it("chooses the fairest playable merge point without changing movements", () => {
    const source = [event(a, b, 300), event(c, d, 600)];
    const isPlayable = vi.fn(() => true);
    const result = compactOneStandardWindow({
      source,
      players: [a, b, c, d],
      halfDurationSeconds: 1_200,
      maxSpreadSeconds: 300,
      isPlayable,
      calculateSpread: (_players, candidate) => Math.abs(candidate[0].time - 450),
    });

    expect(result?.map(({ playerOut, playerIn, time, half }) => ({
      out: playerOut.id,
      in: playerIn.id,
      time,
      half,
    }))).toEqual([
      { out: "a", in: "b", time: 450, half: 1 },
      { out: "c", in: "d", time: 450, half: 1 },
    ]);
    expect(isPlayable).toHaveBeenCalled();
    expect(source.map(({ time }) => time)).toEqual([300, 600]);
  });

  it("never compacts across halftime or consumes its explicit handover", () => {
    const result = compactOneStandardWindow({
      source: [event(a, b, 500, 1), event(c, d, 0, 2)],
      players: [a, b, c, d],
      halfDurationSeconds: 600,
      maxSpreadSeconds: 300,
      isPlayable: () => true,
      calculateSpread: () => 0,
    });
    expect(result).toBeNull();
  });

  it("rejects merges that are unplayable or exceed the selected spread", () => {
    const options = {
      source: [event(a, b, 300), event(c, d, 600)],
      players: [a, b, c, d],
      halfDurationSeconds: 1_200,
      maxSpreadSeconds: 300,
    };

    expect(compactOneStandardWindow({
      ...options,
      isPlayable: () => false,
      calculateSpread: () => 0,
    })).toBeNull();
    expect(compactOneStandardWindow({
      ...options,
      isPlayable: () => true,
      calculateSpread: () => 301,
    })).toBeNull();
  });
});
