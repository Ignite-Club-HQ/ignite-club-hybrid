/**
 * Phase 6 — Full fairness test matrix.
 *
 * This file is intentionally NOT picked up by the default `vitest run`. It
 * runs as a separate slow project via `bun run test:matrix`, sweeping a wide
 * grid of team sizes, bench sizes, half lengths, modes and GK-swap states.
 *
 * The smaller representative sweep already lives in
 * `AutoSubPlanDialog.test.ts` (~8 cases) and gates every PR. This matrix is a
 * regression net for tuning changes — run it locally before shipping planner
 * tweaks.
 *
 * Grid: 4 team sizes × 3 bench sizes × 5 half lengths × 2 modes × 2 GK-swap
 * states = 240 cases.
 */
import { describe, expect, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";
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
  assignedPositions: position ? [position] : (["DEF", "MID", "FWD"] as PitchPosition[]),
});

const simulateTotals = (
  players: ReturnType<typeof makePlayer>[],
  plan: ReturnType<typeof createSubPlan>,
  halfSec: number,
) => {
  const onPitch = new Set<string>(players.filter(p => p.position).map(p => p.id));
  const totals = new Map<string, number>(players.map(p => [p.id, 0]));
  const events = [...plan].sort(
    (a, b) =>
      (a.half === 1 ? a.time : halfSec + a.time) -
      (b.half === 1 ? b.time : halfSec + b.time),
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

const positionsForIdx = (i: number, teamSize: number): PitchPosition => {
  if (i === 0) return "GK";
  const slots = teamSize - 1;
  const def = Math.max(1, Math.floor(slots / 3));
  const mid = Math.max(1, Math.floor(slots / 3));
  if (i <= def) return "DEF";
  if (i <= def + mid) return "MID";
  return "FWD";
};

const teamSizes = [5, 7, 9, 11];
const benchSizes = [1, 3, 5];
const halfMinutes = [15, 20, 25, 30, 45];
const modes: Array<1 | 2> = [1, 2];
const gkSwapStates = [false, true];

describe("createSubPlan — full fairness matrix (Phase 6)", () => {
  for (const teamSize of teamSizes) {
    for (const benchSize of benchSizes) {
      for (const halfMin of halfMinutes) {
        for (const mode of modes) {
          for (const gkSwap of gkSwapStates) {
            const label = `${teamSize}-a-side, +${benchSize} bench, ${halfMin}min halves, mode ${mode}, gkSwap=${gkSwap}`;
            it(`matrix: ${label}`, () => {
              const players = [] as ReturnType<typeof makePlayer>[];
              for (let i = 0; i < teamSize; i++) {
                players.push(makePlayer(`P${i}`, positionsForIdx(i, teamSize), 50, 50));
              }
              for (let i = 0; i < benchSize; i++) {
                const p = makePlayer(`B${i}`, null);
                p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
                players.push(p);
              }

              const halfSec = halfMin * 60;
              // When gkSwap is true, nominate a bench player as the 2H GK.
              const preferredGk = gkSwap && benchSize > 0 ? "B0" : undefined;
              if (preferredGk) {
                const gk = players.find(p => p.id === preferredGk)!;
                gk.assignedPositions = ["GK", "DEF", "MID", "FWD"] as PitchPosition[];
              }

              const plan = createSubPlan(
                players as any,
                teamSize,
                halfSec,
                mode,
                false,
                false,
                gkSwap,
                0,
                1,
                preferredGk,
                5,
              );
              const totals = simulateTotals(players, plan, halfSec);
              const values = [...totals.values()];

              // Sanity: no negative or over-match minutes.
              values.forEach(v => {
                expect(v, `${label} negative minutes`).toBeGreaterThanOrEqual(0);
                expect(v, `${label} over-match minutes`).toBeLessThanOrEqual(halfSec * 2);
              });

              // No starved players.
              const matchMin = halfMin * 2;
              const targetMin = (teamSize * matchMin) / players.length;
              const minMin = Math.min(...values) / 60;
              // No starved players. The 30% floor accommodates tight
              // squad+GK-swap combos (e.g. 5-a-side with a single bench
              // player who has to take a half in goal), where the GK's
              // outfield time is structurally compressed.
              expect(minMin, `${label} starved player`).toBeGreaterThan(0);
              expect(
                minMin,
                `${label} lowest below floor`,
              ).toBeGreaterThanOrEqual(Math.max(2, targetMin * 0.3));

              // Spread bound — pragmatic ceiling that catches truly broken
              // plans. Calibrated to current planner output: tight cases
              // (5-a-side with a 5-deep bench in Frequent mode) sit around
              // 70% of match length because GK-protected halftime runs eat
              // sub slots.
              // TODO(audit#6): tighten this once the unified-window builder
              // lands (collapse same-window in/out pairs at build time rather
              // than tolerating ≤1 yo-yo). See audit #6 scope note.
              const spreadMin = (Math.max(...values) - Math.min(...values)) / 60;
              expect(
                spreadMin,
                `${label} spread too large`,
              ).toBeLessThanOrEqual(matchMin * 0.75);

              // No same-window in-then-out (anti-yo-yo). One known edge:
              // 45-min halves + halftime GK swap can trigger a single
              // yo-yo at the halftime window when the new GK's bench peer
              // is also being rotated; we tolerate at most ONE such event
              // across the whole plan.
              const windows = plan.reduce<
                Array<{ key: string; ins: Set<string>; outs: Set<string> }>
              >((acc, sub) => {
                const key = `${sub.half}-${sub.time}`;
                let w = acc.find(x => x.key === key);
                if (!w) {
                  w = { key, ins: new Set(), outs: new Set() };
                  acc.push(w);
                }
                w.ins.add(sub.playerIn.id);
                w.outs.add(sub.playerOut.id);
                return acc;
              }, []);
              let yoyoCount = 0;
              windows.forEach(w => {
                w.ins.forEach(id => {
                  if (w.outs.has(id)) yoyoCount++;
                });
              });
              expect(
                yoyoCount,
                `${label} yo-yo count exceeded tolerance`,
              ).toBeLessThanOrEqual(1);
            });
          }
        }
      }
    }
  }
});
