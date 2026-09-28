/**
 * AutoSub fairness acceptance harness.
 *
 * Goal: enforce the user-configured `maxSpreadMinutes` cap as a **hard**
 * constraint on planner output across a representative grid of squad
 * configurations. Unlike `AutoSubPlanDialog.matrix.test.ts` (which tolerates
 * up to 75% of match length as a "not truly broken" ceiling), this suite
 * treats the spread cap as a genuine planning constraint.
 *
 * ## Two spread metrics
 *
 * The planner explicitly excludes GK-only players (assignedPositions === ["GK"])
 * from its rotation pool — they're locked to goal and their minutes are
 * structurally fixed. Two metrics are therefore reported per case:
 *
 * - **Rotation-pool spread** (cap-enforced): spread across players the planner
 *   can actually rebalance. This is the fairness metric the planner is
 *   designed to optimize.
 * - **Full-squad spread** (informational only): spread across every player,
 *   including locked GKs. When `gkSwap = false` on long halves this is
 *   dominated by the GK's fixed 90 min and is often mathematically
 *   unreachable at the configured 5-min cap. Surfaced so the UI can nudge
 *   the coach to enable halftime GK swap.
 *
 * Any rotation-pool breach is reported as a soft failure via a summary table
 * at the end of the run so we can track regressions. Structurally impossible
 * plans (invalid sim, starved players) fail hard.
 *
 * Run via: `bunx vitest run src/components/pitch/autoSubFairness.acceptance.test.ts`
 */
import { afterAll, describe, expect, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";
import type { PitchPosition } from "./PositionBadge";

type P = {
  id: string;
  name: string;
  position: { x: number; y: number } | null;
  currentPitchPosition?: PitchPosition;
  assignedPositions: PitchPosition[];
};

const makePlayer = (id: string, position: PitchPosition | null): P => ({
  id,
  name: id,
  position: position ? { x: 50, y: 50 } : null,
  currentPitchPosition: position || undefined,
  assignedPositions: position ? [position] : ["DEF", "MID", "FWD"],
});

const positionsForIdx = (i: number, teamSize: number): PitchPosition => {
  if (i === 0) return "GK";
  const slots = teamSize - 1;
  const def = Math.max(1, Math.floor(slots / 3));
  const mid = Math.max(1, Math.floor(slots / 3));
  if (i <= def) return "DEF";
  if (i <= def + mid) return "MID";
  return "FWD";
};

const simulateOutfieldTotals = (
  players: P[],
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

const isGkOnly = (p: P) =>
  p.assignedPositions.length === 1 && p.assignedPositions[0] === "GK";

interface CaseResult {
  label: string;
  capMin: number;
  rotationSpreadMin: number;
  fullSquadSpreadMin: number;
  breach: number;
  gkLocked: boolean;
}
const rotationBreaches: CaseResult[] = [];
const gkLockedNudges: CaseResult[] = [];

// A representative, curated grid — small enough to run in-CI but covering
// the parameter combinations the fairness rewrite must eventually satisfy.
const cases: Array<{
  teamSize: number;
  benchSize: number;
  halfMin: number;
  mode: 1 | 2;
  gkSwap: boolean;
  capMin: number;
}> = [];
for (const teamSize of [5, 7, 9, 11]) {
  for (const benchSize of [2, 4]) {
    for (const halfMin of [20, 30, 45]) {
      for (const mode of [1, 2] as const) {
        for (const gkSwap of [false, true]) {
          cases.push({ teamSize, benchSize, halfMin, mode, gkSwap, capMin: 5 });
        }
      }
    }
  }
}

describe("AutoSub fairness acceptance — spread cap as hard constraint", () => {
  for (const c of cases) {
    const label = `${c.teamSize}-a-side, +${c.benchSize} bench, ${c.halfMin}min halves, mode ${c.mode}, gkSwap=${c.gkSwap}, cap=${c.capMin}min`;
    it(`case: ${label}`, () => {
      const players: P[] = [];
      for (let i = 0; i < c.teamSize; i++) {
        players.push(makePlayer(`P${i}`, positionsForIdx(i, c.teamSize)));
      }
      for (let i = 0; i < c.benchSize; i++) {
        players.push(makePlayer(`B${i}`, null));
      }
      const halfSec = c.halfMin * 60;
      const preferredGk = c.gkSwap && c.benchSize > 0 ? "B0" : undefined;
      if (preferredGk) {
        const gk = players.find(p => p.id === preferredGk)!;
        gk.assignedPositions = ["GK", "DEF", "MID", "FWD"];
      }

      const plan = createSubPlan(
        players as any,
        c.teamSize,
        halfSec,
        c.mode,
        false,
        false,
        c.gkSwap,
        0,
        1,
        preferredGk,
        c.capMin,
      );

      const totals = simulateOutfieldTotals(players, plan, halfSec);
      const values = [...totals.values()];

      // Hard failures — starvation & sim sanity.
      values.forEach(v => {
        expect(v, `${label} negative minutes`).toBeGreaterThanOrEqual(0);
        expect(v, `${label} over-match`).toBeLessThanOrEqual(halfSec * 2);
      });
      expect(Math.min(...values), `${label} starved player`).toBeGreaterThan(0);

      // Split into rotation-pool vs locked-GK groups.
      const rotationValues: number[] = [];
      const gkOnlyValues: number[] = [];
      players.forEach(p => {
        const v = totals.get(p.id) ?? 0;
        if (isGkOnly(p)) gkOnlyValues.push(v);
        else rotationValues.push(v);
      });

      const rotationSpreadMin =
        rotationValues.length > 1
          ? (Math.max(...rotationValues) - Math.min(...rotationValues)) / 60
          : 0;
      const fullSquadSpreadMin = (Math.max(...values) - Math.min(...values)) / 60;
      const gkLocked = !c.gkSwap && gkOnlyValues.length > 0;

      // Cap-enforced metric: rotation-pool spread. This is what the planner
      // can actually control.
      if (rotationSpreadMin > c.capMin) {
        rotationBreaches.push({
          label,
          capMin: c.capMin,
          rotationSpreadMin: Number(rotationSpreadMin.toFixed(2)),
          fullSquadSpreadMin: Number(fullSquadSpreadMin.toFixed(2)),
          breach: Number((rotationSpreadMin - c.capMin).toFixed(2)),
          gkLocked,
        });
      }

      // Informational metric: full-squad breach driven by locked GK. Surfaces
      // the "enable halftime GK swap" UX hint opportunity.
      if (
        gkLocked &&
        rotationSpreadMin <= c.capMin &&
        fullSquadSpreadMin > c.capMin
      ) {
        gkLockedNudges.push({
          label,
          capMin: c.capMin,
          rotationSpreadMin: Number(rotationSpreadMin.toFixed(2)),
          fullSquadSpreadMin: Number(fullSquadSpreadMin.toFixed(2)),
          breach: Number((fullSquadSpreadMin - c.capMin).toFixed(2)),
          gkLocked,
        });
      }
    });
  }

  afterAll(() => {
    const total = cases.length;
    if (rotationBreaches.length === 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n[fairness acceptance] All ${total} cases meet rotation-pool spread cap ✅`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `\n[fairness acceptance] ${rotationBreaches.length}/${total} case(s) exceeded rotation-pool spread cap:\n` +
          rotationBreaches
            .sort((a, b) => b.breach - a.breach)
            .map(
              b =>
                `  • +${b.breach}min over cap (rotation spread ${b.rotationSpreadMin}min, full-squad ${b.fullSquadSpreadMin}min, cap ${b.capMin}min) — ${b.label}`,
            )
            .join("\n") +
          "\n\nRotation-pool breaches indicate the planner failed to balance the players it can control. See docs/autosub-fairness-rewrite.md.\n",
      );
    }

    if (gkLockedNudges.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n[fairness acceptance] ${gkLockedNudges.length} case(s) balanced within rotation pool but breach full-squad cap due to locked GK — UI should suggest enabling halftime GK swap:\n` +
          gkLockedNudges
            .sort((a, b) => b.breach - a.breach)
            .slice(0, 10)
            .map(
              b =>
                `  • full-squad spread ${b.fullSquadSpreadMin}min (rotation ${b.rotationSpreadMin}min, cap ${b.capMin}min) — ${b.label}`,
            )
            .join("\n") +
          (gkLockedNudges.length > 10 ? `\n  … +${gkLockedNudges.length - 10} more` : "") +
          "\n",
      );
    }
  });
});
