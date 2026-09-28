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

function squad(teamSize: number, benchSize: number): TestPlayer[] {
  const positions = (index: number): PitchPosition => {
    if (index === 0) return "GK";
    const outfield = teamSize - 1;
    if (index <= Math.max(1, Math.floor(outfield / 3))) return "DEF";
    if (index <= Math.max(2, Math.floor(outfield * 2 / 3))) return "MID";
    return "FWD";
  };
  const players: TestPlayer[] = [];
  for (let index = 0; index < teamSize; index += 1) {
    const role = positions(index);
    players.push({
      id: `starter-${index}`, name: `Starter ${index}`,
      position: { x: 50, y: 50 }, currentPitchPosition: role,
      assignedPositions: [role],
    });
  }
  for (let index = 0; index < benchSize; index += 1) {
    players.push({
      id: `bench-${index}`, name: `Bench ${index}`, position: null,
      assignedPositions: ["DEF", "MID", "FWD"],
    });
  }
  // The selected second-half goalkeeper must remain eligible for outfield
  // rotation in H1; otherwise its fixed GK duty would make equality impossible.
  players.find((player) => player.id === "bench-0")!.assignedPositions = ["GK", "DEF", "MID", "FWD"];
  return players;
}

function rotationSpreadSeconds(players: TestPlayer[], plan: ReturnType<typeof createSubPlan>, halfSec: number) {
  const onPitch = new Set(players.filter((player) => player.position).map((player) => player.id));
  const totals = new Map(players.map((player) => [player.id, 0]));
  const ordered = [...plan].sort((a, b) =>
    (a.half === 1 ? a.time : halfSec + a.time) -
    (b.half === 1 ? b.time : halfSec + b.time));
  let previous = 0;
  for (const sub of ordered) {
    const at = sub.half === 1 ? sub.time : halfSec + sub.time;
    onPitch.forEach((id) => totals.set(id, totals.get(id)! + at - previous));
    onPitch.delete(sub.playerOut.id);
    onPitch.add(sub.playerIn.id);
    previous = at;
  }
  onPitch.forEach((id) => totals.set(id, totals.get(id)! + halfSec * 2 - previous));
  // Exclude only the locked first-half GK. Everyone else is controllable by
  // the selected halftime-GK rotation and belongs in the fairness promise.
  const values = players
    .filter((player) => player.id !== "starter-0")
    .map((player) => totals.get(player.id) ?? 0);
  return Math.max(...values) - Math.min(...values);
}

describe("autosub fairness with halftime goalkeeper rotation", () => {
  it.each([
    { teamSize: 5, benchSize: 2, halfMin: 20, mode: 1 as const },
    { teamSize: 7, benchSize: 2, halfMin: 20, mode: 2 as const },
    { teamSize: 11, benchSize: 4, halfMin: 30, mode: 2 as const },
  ])(
    "$teamSize-a-side + $benchSize bench keeps controllable players within the selected five-minute spread",
    ({ teamSize, benchSize, halfMin, mode }) => {
      const players = squad(teamSize, benchSize);
      const halfSec = halfMin * 60;
      const plan = createSubPlan(
        players as any, teamSize, halfSec, mode,
        false, false, true, 0, 1, "bench-0", 5,
      );
      expect(plan.length).toBeGreaterThan(0);
      expect(
        rotationSpreadSeconds(players, plan, halfSec),
        "planner exceeded the explicitly selected maximum playing-time spread",
      ).toBeLessThanOrEqual(5 * 60);
    },
  );
});
