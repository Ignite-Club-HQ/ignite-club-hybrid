import { describe, expect, it } from "vitest";
import type { PitchPosition } from "../PositionBadge";
import { buildEqualTimePlan, type EqualTimePlayer } from "./equalTime";

const makePlayer = (
  id: string,
  position: PitchPosition | null,
  assignedPositions?: PitchPosition[],
  overrides: Partial<EqualTimePlayer> = {},
): EqualTimePlayer => ({
  id,
  name: `Player ${id}`,
  position: position ? { x: 50, y: 50 } : null,
  currentPitchPosition: position ?? undefined,
  assignedPositions,
  ...overrides,
});

/**
 * Acceptance suite for constrained, squad-wide playing-time fairness.
 *
 * Mandatory constraints take precedence over optimisation: unavailable players,
 * positional eligibility, goalkeeper assignments, minimum shifts and blackout
 * windows must always be respected. Within those constraints, the planner should
 * minimise the projected playing-time spread across eligible outfield players,
 * taking minutes already played into account. Multi-player rotations are allowed
 * when they are needed to produce a legal, fair substitution.
 */
describe("buildEqualTimePlan constrained fairness acceptance", () => {
  it("only makes position-legal direct or three-player substitutions", () => {
    const players = [
      makePlayer("def-1", "DEF", ["DEF"]),
      makePlayer("mid-1", "MID", ["MID"]),
      makePlayer("fwd-1", "FWD", ["FWD"]),
      makePlayer("utility-1", "MID", ["DEF", "MID"]),
      makePlayer("def-2", null, ["DEF"]),
      makePlayer("fwd-2", null, ["FWD"]),
    ];

    const result = buildEqualTimePlan({
      players,
      teamSize: 4,
      halfDurationSec: 20 * 60,
      chunkSec: 30,
      minShiftSec: 2 * 60,
    });

    expect(result.plan.length).toBeGreaterThan(0);
    const livePosition = new Map<string, PitchPosition>();
    players.forEach((player) => {
      if (player.position && player.currentPitchPosition) {
        livePosition.set(player.id, player.currentPitchPosition);
      }
    });

    for (const event of result.plan) {
      const vacatedPosition = livePosition.get(event.playerOut.id);
      expect(vacatedPosition).toBeDefined();

      if (event.positionSwap) {
        expect(event.playerIn.assignedPositions).toContain(
          event.positionSwap.fromPosition,
        );
        expect(event.positionSwap.player.assignedPositions).toContain(
          event.positionSwap.toPosition,
        );
        expect(livePosition.get(event.positionSwap.player.id)).toBe(
          event.positionSwap.fromPosition,
        );
        expect(event.positionSwap.toPosition).toBe(vacatedPosition);
        livePosition.set(
          event.positionSwap.player.id,
          event.positionSwap.toPosition,
        );
        livePosition.set(event.playerIn.id, event.positionSwap.fromPosition);
      } else {
        expect(event.playerIn.assignedPositions).toContain(
          vacatedPosition,
        );
        livePosition.set(event.playerIn.id, vacatedPosition!);
      }
      livePosition.delete(event.playerOut.id);
    }
  });

  it("excludes injured and goalkeeper-only players from outfield rotation", () => {
    const halfDurationSec = 20 * 60;
    const goalkeeper = makePlayer("gk", "GK", ["GK"]);
    const injured = makePlayer("injured", null, ["MID"], { isInjured: true });
    const players = [
      goalkeeper,
      makePlayer("def", "DEF", ["DEF", "MID"]),
      makePlayer("mid", "MID", ["MID"]),
      makePlayer("fwd", "FWD", ["FWD", "MID"]),
      makePlayer("bench-1", null, ["MID", "FWD"]),
      makePlayer("bench-2", null, ["DEF", "MID"]),
      injured,
    ];

    const result = buildEqualTimePlan({
      players,
      teamSize: 4,
      halfDurationSec,
      gk1H: goalkeeper,
      gk2H: goalkeeper,
    });

    // Goalkeeping minutes are recorded, but a goalkeeper-only player has no
    // outfield fairness target and must never enter the outfield rotation.
    expect(result.projectedSec.get(goalkeeper.id)).toBe(halfDurationSec);
    expect(result.targetSec.has(goalkeeper.id)).toBe(false);
    expect(result.projectedSec.has(injured.id)).toBe(false);
    expect(result.plan.some((event) => event.playerIn.id === injured.id)).toBe(false);
    expect(result.plan.some((event) => event.playerIn.id === goalkeeper.id)).toBe(false);
    expect(result.projectedSec.get("bench-1")).toBeGreaterThan(0);
    expect(result.projectedSec.get("bench-2")).toBeGreaterThan(0);
  });

  it("honours a halftime goalkeeper change without starving either rotation player", () => {
    const gk1 = makePlayer("gk-1", "GK", ["GK", "MID"]);
    const gk2 = makePlayer("gk-2", null, ["GK", "MID"]);
    const players = [
      gk1,
      makePlayer("def", "DEF", ["DEF", "MID"]),
      makePlayer("mid", "MID", ["MID"]),
      makePlayer("fwd", "FWD", ["FWD", "MID"]),
      gk2,
      makePlayer("bench", null, ["DEF", "MID", "FWD"]),
    ];

    const result = buildEqualTimePlan({
      players,
      teamSize: 4,
      halfDurationSec: 20 * 60,
      gk1H: gk1,
      gk2H: gk2,
    });

    expect(result.plan).toContainEqual(
      expect.objectContaining({
        half: 2,
        time: 0,
        playerOut: expect.objectContaining({ id: gk1.id }),
        playerIn: expect.objectContaining({ id: gk2.id }),
      }),
    );
    expect(result.projectedSec.get(gk1.id)).toBeGreaterThan(0);
    expect(result.projectedSec.get(gk2.id)).toBeGreaterThan(0);
  });

  it("respects blackout windows and minimum shift duration", () => {
    const halfDurationSec = 20 * 60;
    const noSubBeforeSec = 3 * 60;
    const noSubAfterSec = 2 * 60;
    const minShiftSec = 2 * 60;
    const players = Array.from({ length: 7 }, (_, index) =>
      makePlayer(
        String(index + 1),
        index < 5 ? "MID" : null,
        ["MID"],
      ),
    );

    const result = buildEqualTimePlan({
      players,
      teamSize: 5,
      halfDurationSec,
      chunkSec: 30,
      minShiftSec,
      noSubBeforeSec,
      noSubAfterSec,
    });

    const lastInvolvement = new Map<string, number>();
    for (const event of result.plan) {
      const absoluteTime =
        event.half === 1 ? event.time : halfDurationSec + event.time;
      expect(event.time).toBeGreaterThanOrEqual(noSubBeforeSec);
      expect(event.time).toBeLessThan(halfDurationSec - noSubAfterSec);

      for (const id of [event.playerOut.id, event.playerIn.id]) {
        const previous = lastInvolvement.get(id);
        if (previous !== undefined) {
          expect(absoluteTime - previous).toBeGreaterThanOrEqual(minShiftSec);
        }
        lastInvolvement.set(id, absoluteTime);
      }
    }
  });

  it("uses prior playing time to favour players with the largest remaining deficit", () => {
    const players = [
      makePlayer("ahead-1", "MID", ["MID"], { minutesPlayed: 10 * 60 }),
      makePlayer("ahead-2", "MID", ["MID"], { minutesPlayed: 10 * 60 }),
      makePlayer("level-1", "MID", ["MID"]),
      makePlayer("level-2", "MID", ["MID"]),
      makePlayer("behind-1", null, ["MID"]),
      makePlayer("behind-2", null, ["MID"]),
    ];

    const result = buildEqualTimePlan({
      players,
      teamSize: 4,
      halfDurationSec: 20 * 60,
      chunkSec: 30,
      minShiftSec: 2 * 60,
    });

    expect(result.projectedSec.get("behind-1")).toBeGreaterThan(0);
    expect(result.projectedSec.get("behind-2")).toBeGreaterThan(0);
    expect(result.plan.slice(0, 2).map((event) => event.playerIn.id)).toEqual(
      expect.arrayContaining(["behind-1", "behind-2"]),
    );
  });
});
