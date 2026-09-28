import { describe, expect, it } from "vitest";
import { buildEqualTimePlan, equalTimeTargetSec, type EqualTimePlayer } from "./equalTime";
import type { PitchPosition } from "../PositionBadge";

// -----------------------------------------------------------------------------
// Regression tests for the equal-playing-time planner.
//
// The scenarios below were the smallest reproductions of the multi-substitute
// stalemate: the pre-fix scorer rejected any swap that did not immediately
// reduce the maximum absolute deviation, so whenever two bench players were
// equally under-played it produced zero rotations. Post-fix the scorer uses
// squad-wide sum-of-squared deviations, so it swaps whenever total fairness
// improves — even if the max is temporarily unchanged.
// -----------------------------------------------------------------------------

const HALF = 25 * 60; // 1500s per half → 3000s total
const OUTFIELD_POSITIONS: PitchPosition[] = ["DEF", "MID", "FWD", "GK"];

const makePlayer = (
  id: string,
  onPitch: boolean,
  pos?: PitchPosition,
): EqualTimePlayer => ({
  id,
  name: id,
  position: onPitch ? { x: 0, y: 0 } : null,
  currentPitchPosition: onPitch ? pos ?? "MID" : undefined,
});

/** Build a squad of `total` players with the first `starters` on the pitch. */
const squad = (total: number, starters: number): EqualTimePlayer[] => {
  const players: EqualTimePlayer[] = [];
  for (let i = 0; i < starters; i += 1) {
    // Rotate through outfield positions so eligibility never becomes the
    // limiting factor. Position eligibility isn't restricted here — every
    // player has `assignedPositions` unset which means "anywhere".
    const pos = OUTFIELD_POSITIONS[i % (OUTFIELD_POSITIONS.length - 1)];
    players.push(makePlayer(`p${i + 1}`, true, pos));
  }
  for (let i = starters; i < total; i += 1) {
    players.push(makePlayer(`p${i + 1}`, false));
  }
  return players;
};

/** Sum of projected seconds across every rotation player. */
const totalProjected = (projected: Map<string, number>): number => {
  let sum = 0;
  projected.forEach((v) => {
    sum += v;
  });
  return sum;
};

describe("buildEqualTimePlan — squad-wide fairness", () => {
  it("five players rotating through four positions reach equality within one chunk", () => {
    // 5 players, 4 outfield slots, no GK case — the classic stalemate.
    const players = squad(5, 4);
    const res = buildEqualTimePlan({
      players,
      teamSize: 4,
      halfDurationSec: HALF,
      minShiftSec: 120,
      chunkSec: 30,
      noSubBeforeSec: 0,
      noSubAfterSec: 0,
    });

    expect(res.plan.length).toBeGreaterThan(0);

    const target = equalTimeTargetSec(5, 4, HALF * 2);
    res.projectedSec.forEach((secs) => {
      expect(Math.abs(secs - target)).toBeLessThanOrEqual(30);
    });
    expect(res.spreadSec).toBeLessThanOrEqual(30);
  });

  it.each([
    { squadSize: 7, teamSize: 5, label: "7-player / 5-a-side" },
    { squadSize: 9, teamSize: 7, label: "9-player / 7-a-side" },
    { squadSize: 11, teamSize: 9, label: "11-player / 9-a-side" },
  ])("$label finishes within one chunk of the mathematical fairness floor", ({ squadSize, teamSize }) => {
    const players = squad(squadSize, teamSize);
    const res = buildEqualTimePlan({
      players,
      teamSize,
      halfDurationSec: HALF,
      minShiftSec: 30,
      chunkSec: 30,
      noSubBeforeSec: 0,
      noSubAfterSec: 0,
    });

    // Should actually schedule rotations — pre-fix this was zero for every
    // multi-substitute case.
    expect(res.plan.length).toBeGreaterThan(0);

    const target = equalTimeTargetSec(squadSize, teamSize, HALF * 2);
    // True mathematical floor at 30s chunk resolution: with `slots × chunks`
    // discrete chunks distributed across N players, the best-possible max
    // deviation is `max(ceil(per) - per, per - floor(per)) × chunkSec`.
    const chunkSec = 30;
    const totalChunks = teamSize * ((HALF * 2) / chunkSec);
    const per = totalChunks / squadSize;
    const chunkFloor = Math.max(Math.ceil(per) - per, per - Math.floor(per)) * chunkSec;
    res.projectedSec.forEach((secs) => {
      expect(Math.abs(secs - target)).toBeLessThanOrEqual(chunkSec + chunkFloor + 1e-6);
    });
  });

  it("conserves total allocated player-seconds", () => {
    const teamSize = 7;
    const squadSize = 9;
    const players = squad(squadSize, teamSize);
    const res = buildEqualTimePlan({
      players,
      teamSize,
      halfDurationSec: HALF,
      minShiftSec: 120,
      chunkSec: 30,
      noSubBeforeSec: 0,
      noSubAfterSec: 0,
    });

    // Each chunk credits `chunkSec` seconds to every on-pitch outfielder, so
    // total = teamSize × totalSec exactly.
    expect(totalProjected(res.projectedSec)).toBe(teamSize * HALF * 2);
  });

  it("uses a compact cyclic schedule instead of micro-substitutions when every player is position-compatible", () => {
    const players = squad(13, 10);
    const res = buildEqualTimePlan({
      players,
      teamSize: 10,
      halfDurationSec: 40 * 60,
      minShiftSec: 3 * 60,
      chunkSec: 30,
      noSubBeforeSec: 0,
      noSubAfterSec: 30,
    });

    expect(res.plan).toHaveLength(players.length - 1);
    expect(res.spreadSec).toBeLessThanOrEqual(1);
    expect(totalProjected(res.projectedSec)).toBe(10 * 40 * 60 * 2);
  });

  it("every healthy eligible rotation player gets on the pitch", () => {
    const players = squad(9, 7);
    const res = buildEqualTimePlan({
      players,
      teamSize: 7,
      halfDurationSec: HALF,
      minShiftSec: 120,
      chunkSec: 30,
      noSubBeforeSec: 0,
      noSubAfterSec: 0,
    });

    players.forEach((p) => {
      const secs = res.projectedSec.get(p.id) ?? 0;
      expect(secs).toBeGreaterThan(0);
    });
  });
});
