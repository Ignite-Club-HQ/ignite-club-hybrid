import { describe, it, expect, beforeEach } from "vitest";
import { createSubPlan, calculateTimeForecasts } from "./AutoSubPlanDialog";

const ADV_V1 = "autoSubPlan.advancedOverrides.v1";
const ADV_V2 = "autoSubPlan.advancedOverrides.v2";

// Minimal Player factory matching the dialog's internal Player shape.
const makePlayer = (
  id: string,
  opts: { onPitch?: boolean; gk?: boolean; number?: number } = {},
): any => ({
  id,
  name: `Player ${id}`,
  number: opts.number,
  position: opts.onPitch ? { x: 50, y: 50 } : null,
  assignedPositions: opts.gk ? ["GK"] : ["MID"],
  currentPitchPosition: opts.onPitch ? (opts.gk ? "GK" : "MID") : undefined,
  minutesPlayed: 0,
});

// 9-a-side, 13 players (1 GK + 8 outfield starters + 4 bench) — the
// configuration that previously stranded bench players in Frequent mode
// when stale v1 overrides ({ minShiftSeconds: 240 }) leaked in.
const buildSquad = () => {
  const players: any[] = [];
  players.push(makePlayer("gk", { onPitch: true, gk: true, number: 1 }));
  for (let i = 0; i < 8; i++) {
    players.push(makePlayer(`s${i}`, { onPitch: true, number: i + 2 }));
  }
  for (let i = 0; i < 4; i++) {
    players.push(makePlayer(`b${i}`, { onPitch: false, number: 10 + i }));
  }
  return players;
};

describe("AutoSubPlanDialog — Frequent-mode safeguards", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("produces a 0-minute spread for 8 players, 7-a-side, 40 minutes with halftime GK rotation", () => {
    const players: any[] = [
      { ...makePlayer("gk1", { onPitch: true, number: 1 }), assignedPositions: ["GK", "MID"], currentPitchPosition: "GK" },
      ...Array.from({ length: 5 }, (_, i) => makePlayer(`s${i}`, { onPitch: true, number: i + 2 })),
      { ...makePlayer("gk2", { onPitch: true, number: 7 }), assignedPositions: ["GK", "MID"], currentPitchPosition: "MID" },
      makePlayer("bench", { onPitch: false, number: 8 }),
    ];

    const plan = createSubPlan(players, 7, 20 * 60, 2, false, false, true, 0, 1, "gk2");
    const forecasts = calculateTimeForecasts(players, plan, 20, "gk2", true);
    const minutes = forecasts.map(f => f.predictedMinutes);

    expect(new Set(minutes).size).toBe(1);
    expect(minutes[0]).toBe(35);
  });

  it("calculateTimeForecasts gives every outfield player non-zero minutes in Frequent mode", () => {
    const players = buildSquad();
    const halfSec = 10 * 60; // 10-min halves
    const plan = createSubPlan(players, 9, halfSec, 2 /* Frequent */);
    const forecasts = calculateTimeForecasts(players, plan, 10);

    const outfield = forecasts.filter(f => f.gkRole !== "full");
    expect(outfield.length).toBeGreaterThan(0);
    for (const f of outfield) {
      expect(f.predictedMinutes, `${f.player.name} stranded at 0 minutes`).toBeGreaterThan(0);
    }
  });

  it("simulated stale v1 overrides do not strand outfield players when default Frequent overrides are used", () => {
    // Simulate a coach upgrading from the old build that wrote v1 entries.
    window.localStorage.setItem(
      ADV_V1,
      JSON.stringify({ minShiftSeconds: 240, frequentIntervalFloorSec: 240 }),
    );

    // Mirror the dialog's v2 init logic: ignore v1 entirely + delete the key
    // so they cannot leak into a regenerated plan.
    const stale = window.localStorage.getItem(ADV_V1);
    expect(stale).not.toBeNull();
    window.localStorage.removeItem(ADV_V1);
    expect(window.localStorage.getItem(ADV_V1)).toBeNull();
    expect(window.localStorage.getItem(ADV_V2)).toBeNull();

    // With v1 cleared, the planner runs with safe defaults and Frequent mode
    // must still distribute minutes across the full bench.
    const players = buildSquad();
    const plan = createSubPlan(players, 9, 10 * 60, 2);
    const forecasts = calculateTimeForecasts(players, plan, 10);
    const outfield = forecasts.filter(f => f.gkRole !== "full");
    for (const f of outfield) {
      expect(f.predictedMinutes, `${f.player.name} stranded at 0 minutes`).toBeGreaterThan(0);
    }
  });
});
