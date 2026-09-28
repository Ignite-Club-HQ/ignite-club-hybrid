import { describe, expect, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";
import type { PitchPosition } from "./PositionBadge";

type TestPlayer = {
  id: string;
  name: string;
  position: { x: number; y: number } | null;
  currentPitchPosition?: PitchPosition;
  assignedPositions: PitchPosition[];
};

type ModeResult = {
  windows: number;
  movements: number;
  spreadSeconds: number;
  minimumSeconds: number;
};

function makeSquad(teamSize: number, benchSize: number): TestPlayer[] {
  const players: TestPlayer[] = [];
  for (let index = 0; index < teamSize; index += 1) {
    const position: PitchPosition = index === 0
      ? "GK"
      : index <= Math.max(1, Math.floor((teamSize - 1) / 3))
        ? "DEF"
        : index <= Math.max(2, Math.floor(((teamSize - 1) * 2) / 3))
          ? "MID"
          : "FWD";
    players.push({
      id: `starter-${index}`,
      name: `Starter ${index}`,
      position: { x: 50, y: 50 },
      currentPitchPosition: position,
      assignedPositions: position === "GK" ? ["GK"] : ["DEF", "MID", "FWD"],
    });
  }
  for (let index = 0; index < benchSize; index += 1) {
    players.push({
      id: `bench-${index}`,
      name: `Bench ${index}`,
      position: null,
      assignedPositions: ["DEF", "MID", "FWD"],
    });
  }
  return players;
}

function evaluateMode(
  players: TestPlayer[],
  teamSize: number,
  halfSeconds: number,
  mode: 1 | 2,
): ModeResult {
  const plan = createSubPlan(
    players as never,
    teamSize,
    halfSeconds,
    mode,
    false,
    false,
    false,
    0,
    1,
    undefined,
    5,
  );
  const onPitch = new Set(players.filter((player) => player.position).map((player) => player.id));
  const totals = new Map(players.map((player) => [player.id, 0]));
  const ordered = [...plan].sort((left, right) =>
    (left.half === 1 ? left.time : halfSeconds + left.time) -
    (right.half === 1 ? right.time : halfSeconds + right.time));
  let previous = 0;
  for (const substitution of ordered) {
    const at = substitution.half === 1
      ? substitution.time
      : halfSeconds + substitution.time;
    onPitch.forEach((id) => totals.set(id, (totals.get(id) ?? 0) + at - previous));
    onPitch.delete(substitution.playerOut.id);
    onPitch.add(substitution.playerIn.id);
    previous = at;
  }
  onPitch.forEach((id) => totals.set(
    id,
    (totals.get(id) ?? 0) + halfSeconds * 2 - previous,
  ));

  // A full-match GK cannot be balanced by outfield substitutions. The mode
  // contract applies to the rotation pool the planner can actually control.
  const rotationValues = players
    .filter((player) => !(player.assignedPositions.length === 1 && player.assignedPositions[0] === "GK"))
    .map((player) => totals.get(player.id) ?? 0);
  const windows = new Set(plan.map((substitution) =>
    `${substitution.half}:${substitution.time}`)).size;

  return {
    windows,
    movements: plan.length,
    spreadSeconds: Math.max(...rotationValues) - Math.min(...rotationValues),
    minimumSeconds: Math.min(...rotationValues),
  };
}

const representativeCases = [
  { teamSize: 5, benchSize: 2, halfMinutes: 20 },
  { teamSize: 5, benchSize: 4, halfMinutes: 30 },
  { teamSize: 7, benchSize: 2, halfMinutes: 20 },
  { teamSize: 7, benchSize: 4, halfMinutes: 30 },
  { teamSize: 9, benchSize: 2, halfMinutes: 30 },
  { teamSize: 9, benchSize: 4, halfMinutes: 30 },
  { teamSize: 11, benchSize: 2, halfMinutes: 30 },
  { teamSize: 11, benchSize: 4, halfMinutes: 30 },
] as const;

describe("autosub Standard and Frequent mode contract", () => {
  it.each(representativeCases)(
    "Standard is quieter while both modes optimise controllable minutes: $teamSize-a-side +$benchSize, $halfMinutes-minute halves",
    ({ teamSize, benchSize, halfMinutes }) => {
      const players = makeSquad(teamSize, benchSize);
      const halfSeconds = halfMinutes * 60;
      const standard = evaluateMode(players, teamSize, halfSeconds, 1);
      const frequent = evaluateMode(players, teamSize, halfSeconds, 2);
      const label = `${teamSize}-a-side +${benchSize}, ${halfMinutes}-minute halves`;

      expect(standard.minimumSeconds, `${label}: Standard starved a rotation player`).toBeGreaterThan(0);
      expect(frequent.minimumSeconds, `${label}: Frequent starved a rotation player`).toBeGreaterThan(0);
      expect(
        frequent.spreadSeconds,
        `${label}: Frequent exceeded the selected five-minute spread`,
      ).toBeLessThanOrEqual(5 * 60);
      expect(
        standard.spreadSeconds,
        `${label}: Standard exceeded the selected five-minute spread`,
      ).toBeLessThanOrEqual(5 * 60);
      expect(
        standard.windows,
        `${label}: Standard must use fewer substitution windows than Frequent`,
      ).toBeLessThan(frequent.windows);
      // Record the secondary churn measure explicitly: a quieter Standard plan
      // must not hide extra player movements inside fewer batch windows.
      expect(
        standard.movements,
        `${label}: Standard must not move more players than Frequent`,
      ).toBeLessThanOrEqual(frequent.movements);
    },
  );
});
