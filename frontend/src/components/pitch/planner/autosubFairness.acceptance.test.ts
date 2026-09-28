import { describe, expect, it } from "vitest";
import {
  createSubPlan,
  isPlanPlayableFromPlayers,
} from "../AutoSubPlanDialog";
import type { PitchPosition } from "../PositionBadge";
import { buildEqualTimePlan } from "./equalTime";

type TestPlayer = {
  id: string;
  name: string;
  position: { x: number; y: number } | null;
  currentPitchPosition?: PitchPosition;
  assignedPositions: PitchPosition[];
  minutesPlayed?: number;
};

const OUTFIELD: PitchPosition[] = ["DEF", "MID", "FWD"];

function makeSquad(teamSize: number, benchSize: number): TestPlayer[] {
  const players: TestPlayer[] = [{
    id: "gk",
    name: "Goalkeeper",
    position: { x: 50, y: 10 },
    currentPitchPosition: "GK",
    assignedPositions: ["GK"],
  }];
  for (let index = 0; index < teamSize - 1; index += 1) {
    players.push({
      id: `starter-${index}`,
      name: `Starter ${index}`,
      position: { x: 20 + index, y: 30 + index },
      currentPitchPosition: OUTFIELD[index % OUTFIELD.length],
      assignedPositions: [...OUTFIELD],
    });
  }
  for (let index = 0; index < benchSize; index += 1) {
    players.push({
      id: `bench-${index}`,
      name: `Bench ${index}`,
      position: null,
      assignedPositions: [...OUTFIELD],
    });
  }
  return players;
}

function simulateOutfield(
  players: TestPlayer[],
  plan: ReturnType<typeof createSubPlan>,
  halfSec: number,
) {
  const eligible = players.filter((player) => player.id !== "gk");
  const onPitch = new Set(
    eligible.filter((player) => player.position !== null).map((player) => player.id),
  );
  const totals = new Map(eligible.map((player) => [player.id, 0]));
  const ordered = [...plan]
    .filter((event) => event.playerOut.id !== "gk" && event.playerIn.id !== "gk")
    .sort((a, b) =>
      (a.half === 1 ? a.time : halfSec + a.time) -
      (b.half === 1 ? b.time : halfSec + b.time),
    );
  let previous = 0;
  for (const event of ordered) {
    const absolute = event.half === 1 ? event.time : halfSec + event.time;
    expect(absolute).toBeGreaterThanOrEqual(previous);
    onPitch.forEach((id) => totals.set(id, totals.get(id)! + absolute - previous));
    expect(onPitch.has(event.playerOut.id), `${event.playerOut.id} must be on pitch`).toBe(true);
    expect(onPitch.has(event.playerIn.id), `${event.playerIn.id} must be on bench`).toBe(false);
    onPitch.delete(event.playerOut.id);
    onPitch.add(event.playerIn.id);
    previous = absolute;
  }
  const matchSec = halfSec * 2;
  onPitch.forEach((id) => totals.set(id, totals.get(id)! + matchSec - previous));
  return totals;
}

function spread(totals: Map<string, number>) {
  const values = [...totals.values()];
  return Math.max(...values) - Math.min(...values);
}

describe("autosub planner — realistic equal-time acceptance matrix", () => {
  const scenarios = [
    { teamSize: 5, benchSize: 1, halfMin: 20 },
    { teamSize: 5, benchSize: 3, halfMin: 20 },
    { teamSize: 7, benchSize: 1, halfMin: 20 },
    { teamSize: 7, benchSize: 3, halfMin: 25 },
    { teamSize: 7, benchSize: 5, halfMin: 25 },
    { teamSize: 9, benchSize: 2, halfMin: 30 },
    { teamSize: 9, benchSize: 4, halfMin: 35 },
    { teamSize: 11, benchSize: 3, halfMin: 40 },
    { teamSize: 11, benchSize: 5, halfMin: 45 },
  ];

  it.each(scenarios.flatMap((scenario) => [
    { ...scenario, mode: 1 },
    { ...scenario, mode: 2 },
  ]))(
    "$teamSize-a-side + $benchSize bench, $halfMin-minute halves, mode $mode stays within the selected five-minute cap",
    ({ teamSize, benchSize, halfMin, mode }) => {
      const players = makeSquad(teamSize, benchSize);
      const halfSec = halfMin * 60;
      const plan = createSubPlan(
        players as any,
        teamSize,
        halfSec,
        mode,
        false,
        false,
        false,
        0,
        1,
        undefined,
        5,
      );
      expect(isPlanPlayableFromPlayers(players, plan, halfSec)).toBe(true);

      const totals = simulateOutfield(players, plan, halfSec);
      const spreadSec = spread(totals);
      const outfieldSlots = teamSize - 1;
      const expectedAllocated = outfieldSlots * halfSec * 2;
      expect([...totals.values()].reduce((sum, value) => sum + value, 0))
        .toBe(expectedAllocated);
      expect(spreadSec, `actual spread ${(spreadSec / 60).toFixed(1)} minutes`)
        .toBeLessThanOrEqual(5 * 60);
      totals.forEach((seconds, id) => {
        expect(seconds, `${id} was starved`).toBeGreaterThan(0);
        expect(seconds, `${id} exceeded match duration`).toBeLessThanOrEqual(halfSec * 2);
      });
    },
  );

  it("does not change fairness when player identifiers and input ordering change", () => {
    const halfSec = 25 * 60;
    const original = makeSquad(7, 4);
    const renamed = [...original]
      .reverse()
      .map((player, index) => ({
        ...player,
        id: player.id === "gk" ? "gk" : `renamed-${String(index).padStart(2, "0")}`,
      }));

    const first = createSubPlan(original as any, 7, halfSec, 2, false, false, false);
    const second = createSubPlan(renamed as any, 7, halfSec, 2, false, false, false);

    expect(spread(simulateOutfield(original, first, halfSec)))
      .toBe(spread(simulateOutfield(renamed, second, halfSec)));
  });

  it("uses prior minutes to close an existing deficit rather than widening it", () => {
    const players = makeSquad(7, 3);
    players.filter((player) => player.id.startsWith("starter-")).slice(0, 3)
      .forEach((player) => { player.minutesPlayed = 8 * 60; });
    const halfSec = 20 * 60;
    const plan = createSubPlan(
      players as any,
      7,
      halfSec,
      2,
      false,
      false,
      false,
      0,
      1,
      undefined,
      5,
    );
    const final = simulateOutfield(players, plan, halfSec);
    players.forEach((player) => {
      if (player.id !== "gk") {
        final.set(player.id, (final.get(player.id) ?? 0) + (player.minutesPlayed ?? 0));
      }
    });

    expect(spread(final), "prior-minute deficit remains excessively wide")
      .toBeLessThanOrEqual(5 * 60);
  });

  it("is deterministic across repeated planning calls", () => {
    const players = makeSquad(9, 4);
    const args = [players as any, 9, 30 * 60, 2, false, false, false] as const;
    const first = createSubPlan(...args);
    const second = createSubPlan(...args);
    const signature = (plan: ReturnType<typeof createSubPlan>) =>
      plan.map((event) => [
        event.half,
        event.time,
        event.playerOut.id,
        event.playerIn.id,
        event.positionSwap?.player.id ?? null,
      ]);
    expect(signature(second)).toEqual(signature(first));
  });

  it("proves the 17-minute 11-a-side spread is avoidable under the same shift constraints", () => {
    const players = makeSquad(11, 3);
    const halfSec = 40 * 60;
    const productionPlan = createSubPlan(
      players as any,
      11,
      halfSec,
      1,
      false,
      false,
      false,
      0,
      1,
      undefined,
      5,
    );
    const productionSpread = spread(simulateOutfield(players, productionPlan, halfSec));

    const mathematicalControl = buildEqualTimePlan({
      players: players.filter((player) => player.id !== "gk") as any,
      teamSize: 10,
      halfDurationSec: halfSec,
      chunkSec: 30,
      minShiftSec: 3 * 60,
      noSubBeforeSec: 0,
      noSubAfterSec: 30,
    });

    // With three rolling substitutes and a three-minute minimum shift, exact
    // equality is not always schedulable. The independent equal-time planner
    // nevertheless demonstrates that a two-minute spread is feasible.
    expect(mathematicalControl.spreadSec).toBeLessThanOrEqual(2 * 60);
    expect(productionSpread).toBeLessThanOrEqual(2 * 60);
    expect(
      productionSpread - mathematicalControl.spreadSec,
      "production planner should not be materially worse than the feasible control",
    ).toBeLessThanOrEqual(5 * 60);
  });

  it("honours tighter and looser requested spread caps monotonically", () => {
    const players = makeSquad(9, 4);
    const halfSec = 35 * 60;
    const spreads = [2, 5, 10].map((cap) => {
      const plan = createSubPlan(
        players as any,
        9,
        halfSec,
        1,
        false,
        false,
        false,
        0,
        1,
        undefined,
        cap,
      );
      return spread(simulateOutfield(players, plan, halfSec));
    });

    expect(spreads[0]).toBeLessThanOrEqual(spreads[1]);
    expect(spreads[1]).toBeLessThanOrEqual(spreads[2]);
    expect(spreads[0]).toBeLessThanOrEqual(2 * 60);
  });
});
