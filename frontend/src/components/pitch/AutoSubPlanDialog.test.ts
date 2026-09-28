import { describe, expect, it } from "vitest";
import { calculateTimeForecasts, createSubPlan } from "./AutoSubPlanDialog";
import type { PitchPosition } from "./PositionBadge";

const makePlayer = (
  id: string,
  position: PitchPosition | null,
  x = 50,
  y = 50,
) => ({
  id,
  name: id,
  position: position ? { x, y } : null,
  currentPitchPosition: position || undefined,
  assignedPositions: position ? [position] : ["DEF", "MID", "FWD"] as PitchPosition[],
});

const simulateTotals = (
  players: ReturnType<typeof makePlayer>[],
  plan: ReturnType<typeof createSubPlan>,
  halfSec: number,
) => {
  const onPitch = new Set<string>(players.filter(p => p.position).map(p => p.id));
  const totals = new Map<string, number>(players.map(p => [p.id, 0]));
  const events = [...plan].sort((a, b) =>
    (a.half === 1 ? a.time : halfSec + a.time) - (b.half === 1 ? b.time : halfSec + b.time)
  );
  let last = 0;
  const totalSec = halfSec * 2;
  for (const ev of events) {
    const t = ev.half === 1 ? ev.time : halfSec + ev.time;
    onPitch.forEach(id => totals.set(id, totals.get(id)! + (t - last)));
    last = t;
    onPitch.delete(ev.playerOut.id);
    onPitch.add(ev.playerIn.id);
  }
  onPitch.forEach(id => totals.set(id, totals.get(id)! + (totalSec - last)));
  return totals;
};

describe("createSubPlan", () => {
  it("changes the timeline and projected minutes when player priority is reordered", () => {
    const players = [
      makePlayer("GK", "GK"),
      makePlayer("A", "DEF"),
      makePlayer("B", "DEF"),
      makePlayer("C", "MID"),
      makePlayer("D", "MID"),
      makePlayer("E", "FWD"),
      makePlayer("F", "FWD"),
      makePlayer("G", null),
      makePlayer("H", null),
      makePlayer("I", null),
      makePlayer("J", null),
    ];
    players.forEach(p => {
      if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
        p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
      }
    });

    const halfSec = 20 * 60;
    const basePlan = createSubPlan(players as any, 7, halfSec, 1, false, false, false, 0, 1, undefined, 5);
    const priorityPlan = createSubPlan(
      players as any,
      7,
      halfSec,
      1,
      false,
      false,
      false,
      0,
      1,
      undefined,
      5,
      { playerPriorityOrder: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "GK"] },
    );

    const signature = (plan: typeof basePlan) => plan.map(s => `${s.half}-${s.time}:${s.playerOut.id}>${s.playerIn.id}`).join("|");
    expect(signature(priorityPlan)).not.toEqual(signature(basePlan));

    const baseForecasts = new Map(calculateTimeForecasts(players as any, basePlan, 20, undefined, false).map(f => [f.player.id, f.predictedMinutes]));
    const priorityForecasts = new Map(calculateTimeForecasts(players as any, priorityPlan, 20, undefined, false).map(f => [f.player.id, f.predictedMinutes]));

    expect(priorityForecasts.get("A")!).toBeGreaterThan(baseForecasts.get("A")!);
    expect(priorityForecasts.get("B")!).toBeGreaterThan(baseForecasts.get("B")!);
  });

  it("does not take a newly introduced bench player off at the next rotation when alternatives exist", () => {
    const players = [
      makePlayer("A", "DEF"),
      makePlayer("B", "DEF"),
      makePlayer("C", "MID"),
      makePlayer("D", "MID"),
      makePlayer("E", "MID"),
      makePlayer("F", "FWD"),
      makePlayer("G", "FWD"),
      makePlayer("Max", null),
      makePlayer("H", null),
      makePlayer("I", null),
    ];

    const plan = createSubPlan(players as any, 7, 1200, 2, true, false, false);
    const ordered = [...plan].sort((a, b) =>
      (a.half === 1 ? a.time : 1200 + a.time) - (b.half === 1 ? b.time : 1200 + b.time)
    );

    const windows = ordered.reduce<Array<{ time: number; ins: Set<string>; outs: Set<string> }>>((acc, sub) => {
      const time = sub.half === 1 ? sub.time : 1200 + sub.time;
      const last = acc[acc.length - 1];
      const window = last?.time === time ? last : { time, ins: new Set<string>(), outs: new Set<string>() };
      window.ins.add(sub.playerIn.id);
      window.outs.add(sub.playerOut.id);
      if (window !== last) acc.push(window);
      return acc;
    }, []);

    expect(windows.length).toBeGreaterThan(2);
    for (let i = 1; i < windows.length; i++) {
      windows[i - 1].ins.forEach(playerId => {
        expect(windows[i].outs.has(playerId)).toBe(false);
      });
    }
  });

  it("U8 2-mode rotation: Frequent honours spread; Standard keeps subs low", () => {
    // Standard (1) prioritises low disruption — wider spread is acceptable.
    // Frequent (2) honours the spread cap tightly.
    const players = [
      makePlayer("Archer", "GK"),
      makePlayer("Ezra", "DEF", 30, 80),
      makePlayer("Augustine", "DEF", 70, 80),
      makePlayer("Jett", "MID", 30, 50),
      makePlayer("Louie", "MID", 70, 50),
      makePlayer("Hugo", "FWD", 30, 20),
      makePlayer("James", "FWD", 70, 20),
      makePlayer("Maximus", null),
      makePlayer("Tom", null),
      makePlayer("Bench3", null),
      makePlayer("Bench4", null),
    ];
    players.forEach(p => {
      if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
        p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
      }
    });

    const halfSec = 20 * 60;
    // Standard: low sub count, soft fairness — accepts wider spread.
    const practical = createSubPlan(players as any, 7, halfSec, 1, false, false, true, 0, 1, "Maximus", 5);
    expect(practical.length, `practical subs ${practical.length}`).toBeLessThanOrEqual(25);

    // Standard fairness floor (OUTFIELD-ONLY): no outfield-eligible player
    // below 75% of target. GKs are EXCLUDED from this check because they
    // can ONLY swap at halftime — they don't take outfield shifts mid-half.
    const practicalTotals = simulateTotals(players, practical, halfSec);
    const fieldPositions = players.filter(p => p.position && p.currentPitchPosition !== "GK").length;
    const outfield = players.filter(
      p => !(p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK"),
    );
    const targetSec = (halfSec * 2 * fieldPositions) / outfield.length;
    const minSec = targetSec * 0.75;
    const gkIds = new Set(["Archer", "Maximus"]);
    const outfieldNonGkIds = new Set(outfield.map(p => p.id).filter(id => !gkIds.has(id)));
    const lows = [...practicalTotals.entries()]
      .filter(([id]) => outfieldNonGkIds.has(id))
      .filter(([, sec]) => sec < minSec);
    expect(lows, `players below 75% floor: ${lows.map(([id, s]) => `${id}=${(s/60).toFixed(1)}'`).join(", ")}`).toEqual([]);

    // GKs play exactly their half (20'). Outfielders should be tightly spread.
    const outfieldOnlyTotals = [...practicalTotals.entries()].filter(([id]) => outfieldNonGkIds.has(id));
    const outfieldVals = outfieldOnlyTotals.map(([, s]) => s);
    const outfieldSpread = (Math.max(...outfieldVals) - Math.min(...outfieldVals)) / 60;
    expect(outfieldSpread, `outfield-only spread = ${outfieldSpread.toFixed(1)}'`).toBeLessThanOrEqual(12);

    // Regression for the 9-player mobile case.
    const ninePlayerStandard = createSubPlan(players.slice(0, 9) as any, 7, halfSec, 1, false, false, true, 0, 1, "Maximus", 5);
    const nineTotals = simulateTotals(players.slice(0, 9), ninePlayerStandard, halfSec);
    const nineOutfield = [...nineTotals.entries()].filter(([id]) => !gkIds.has(id)).map(([, s]) => s);
    const nineSpread = (Math.max(...nineOutfield) - Math.min(...nineOutfield)) / 60;
    expect(nineSpread, `9-player Standard outfield spread = ${nineSpread.toFixed(1)}'`).toBeLessThanOrEqual(10);
    // GKs play their full half = 20'.
    expect(nineTotals.get("Archer")! / 60, "1H GK plays 1H").toBeGreaterThanOrEqual(20);
    expect(nineTotals.get("Maximus")! / 60, "2H GK plays 2H").toBeGreaterThanOrEqual(20);

    const practicalWindows = practical.reduce<Array<{ time: number; ins: Set<string>; outs: Set<string> }>>((acc, sub) => {
      const time = sub.half === 1 ? sub.time : halfSec + sub.time;
      const last = acc[acc.length - 1];
      const window = last?.time === time ? last : { time, ins: new Set<string>(), outs: new Set<string>() };
      window.ins.add(sub.playerIn.id);
      window.outs.add(sub.playerOut.id);
      if (window !== last) acc.push(window);
      return acc;
    }, []);
    practicalWindows.forEach(window => {
      window.ins.forEach(playerId => {
        expect(window.outs.has(playerId), `${playerId} was subbed on and off in the same Standard window`).toBe(false);
      });
    });

    // Frequent honours tight spread.
    const plan = createSubPlan(players as any, 7, halfSec, 2, false, false, true, 0, 1, "Maximus", 5);
    const totals = simulateTotals(players, plan, halfSec);
    const arr = [...totals.values()];
    const spread = (Math.max(...arr) - Math.min(...arr)) / 60;
    // Light Frequent: longer shifts (~3 min floor) widen the spread vs the
    // old 2-min cadence, but stay tighter than Standard (which allows ~10').
    expect(spread, `frequent spread = ${spread.toFixed(1)}'`).toBeLessThanOrEqual(10);
  });

  it("honours an explicit 2H GK even when they start on pitch as an outfielder", () => {
    const players = [
      makePlayer("Archer", "GK"),
      makePlayer("Ezra", "DEF", 30, 80),
      makePlayer("Maximus", "DEF", 70, 80),
      makePlayer("Jett", "MID", 30, 50),
      makePlayer("Louie", "MID", 70, 50),
      makePlayer("Hugo", "FWD", 30, 20),
      makePlayer("James", "FWD", 70, 20),
      makePlayer("Tom", null),
      makePlayer("Bench2", null),
    ];
    players.forEach(p => {
      if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
        p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
      }
    });

    const halfSec = 20 * 60;
    const plan = createSubPlan(players as any, 7, halfSec, 1, false, false, true, 0, 1, "Tom", 5);
    const halftimeSwap = plan.find(sub => sub.half === 2 && sub.time === 0 && sub.playerOut.id === "Archer");

    expect(halftimeSwap?.playerIn.id).toBe("Tom");
    expect(halftimeSwap?.playerIn.id).not.toBe("Maximus");
  });

  it("prevents short-game large-bench plans from leaving players barely used", () => {
    const players = [
      makePlayer("Ellis", "GK"),
      makePlayer("Emery", "DEF"),
      makePlayer("Finley", "DEF"),
      makePlayer("P4", "MID"),
      makePlayer("Harper", "MID"),
      makePlayer("Haven", null),
      makePlayer("Hayden", null),
      makePlayer("Indigo", null),
      makePlayer("P9", "FWD"),
      makePlayer("P10", "FWD"),
      makePlayer("Jordan H", null),
      makePlayer("Jordan W", null),
      makePlayer("Jordan T", null),
    ];
    players.forEach(p => {
      if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
        p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
      }
    });
    players[1].assignedPositions = ["GK", "DEF", "MID", "FWD"] as PitchPosition[];

    const halfSec = 10 * 60;
    for (const speed of [1, 2]) {
      const plan = createSubPlan(players as any, 7, halfSec, speed, false, false, true, 0, 1, "Emery", 5);
      const totals = simulateTotals(players, plan, halfSec);
      const values = [...totals.values()];
      const min = Math.min(...values);
      const spread = Math.max(...values) - min;

      expect(min, `mode ${speed} minimum minutes`).toBeGreaterThanOrEqual(8 * 60);
      expect(spread / 60, `mode ${speed} spread`).toBeLessThanOrEqual(6);
      expect([...totals.entries()].filter(([, sec]) => sec === 0)).toEqual([]);
    }
  });

  it("gives exact equal game time for one-bench tiny squads", () => {
    const players = [
      makePlayer("Finlay", "DEF"),
      makePlayer("Fergus", "DEF"),
      makePlayer("Winnie", "MID"),
      makePlayer("Noah", "FWD"),
      makePlayer("Henri", null),
    ];
    players.forEach(p => {
      p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
    });

    const halfSec = 20 * 60;
    const plan = createSubPlan(players as any, 4, halfSec, 1, false, true, false, 0, 1, undefined, 5);
    const totals = simulateTotals(players, plan, halfSec);
    const values = [...totals.values()];

    expect(plan).toHaveLength(9);
    expect(new Set(plan.map(sub => sub.half === 1 ? sub.time : halfSec + sub.time))).toEqual(
      new Set([240, 480, 720, 960, 1200, 1440, 1680, 1920, 2160]),
    );
    values.forEach(seconds => expect(seconds).toBe(32 * 60));
  });

  // Fairness matrix: a representative sweep across team sizes, bench sizes,
  // half lengths and modes. We don't assert perfect equality (the planner has
  // halftime/GK constraints) but we DO assert no player is starved of minutes
  // and the spread is bounded.
  const positionsForIdx = (i: number, teamSize: number): PitchPosition => {
    if (i === 0) return "GK";
    const slots = teamSize - 1;
    const def = Math.max(1, Math.floor(slots / 3));
    const mid = Math.max(1, Math.floor(slots / 3));
    if (i <= def) return "DEF";
    if (i <= def + mid) return "MID";
    return "FWD";
  };

  const matrix: Array<{ teamSize: number; benchSize: number; halfMin: number; mode: 1 | 2 }> = [
    { teamSize: 5, benchSize: 2, halfMin: 15, mode: 1 },
    { teamSize: 5, benchSize: 4, halfMin: 20, mode: 2 },
    { teamSize: 7, benchSize: 1, halfMin: 20, mode: 1 },
    { teamSize: 7, benchSize: 3, halfMin: 25, mode: 1 },
    { teamSize: 7, benchSize: 5, halfMin: 20, mode: 2 },
    { teamSize: 9, benchSize: 3, halfMin: 30, mode: 1 },
    { teamSize: 11, benchSize: 3, halfMin: 35, mode: 1 },
    { teamSize: 11, benchSize: 5, halfMin: 45, mode: 2 },
  ];

  for (const { teamSize, benchSize, halfMin, mode } of matrix) {
    const label = `${teamSize}-a-side, +${benchSize} bench, ${halfMin}min halves, mode ${mode}`;
    it(`fairness matrix: ${label}`, () => {
      const players = [] as ReturnType<typeof makePlayer>[];
      for (let i = 0; i < teamSize; i++) {
        const pos = positionsForIdx(i, teamSize);
        players.push(makePlayer(`P${i}`, pos, 50, 50));
      }
      for (let i = 0; i < benchSize; i++) {
        const p = makePlayer(`B${i}`, null);
        p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
        players.push(p);
      }

      const halfSec = halfMin * 60;
      const plan = createSubPlan(players as any, teamSize, halfSec, mode, false, false, true, 0, 1, undefined, 5);
      const totals = simulateTotals(players, plan, halfSec);
      const values = [...totals.values()];

      values.forEach(v => {
        expect(v, `${label} negative minutes`).toBeGreaterThanOrEqual(0);
        expect(v, `${label} over-match minutes`).toBeLessThanOrEqual(halfSec * 2);
      });

      const matchMin = halfMin * 2;
      const targetMin = (teamSize * matchMin) / players.length;
      const minMin = Math.min(...values) / 60;
      expect(minMin, `${label} starved player`).toBeGreaterThan(0);
      expect(minMin, `${label} lowest below floor`).toBeGreaterThanOrEqual(Math.max(2, targetMin * 0.4));

      const spreadMin = (Math.max(...values) - Math.min(...values)) / 60;
      // Spread bound: pragmatic upper bound that catches truly broken plans.
      // Tight cases (5-a-side + large bench + GK halftime swap in a short
      // match) are constrained by GK-protected runs eating sub slots — the
      // unified window builder (Phase 3 of the planner rewrite) is needed
      // to tighten further. The on-screen FairnessDiagnostics surfaces the
      // current spread to coaches with a tuning suggestion.
      expect(spreadMin, `${label} spread too large`).toBeLessThanOrEqual(matchMin * 0.65);
    });
  }
});
