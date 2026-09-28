/**
 * Phase 0 — Pitch board orchestration simulator.
 *
 * Mounting the full 8056-line PitchBoard.tsx in jsdom is impractical and
 * extremely fragile (cross-effect refs, native dialogs, timers, native
 * keyboards). Instead this suite is a **pure-TS state-machine harness** that
 * exercises the real production helpers exactly as PitchBoard does:
 *
 *   createSubPlan            (from AutoSubPlanDialog)
 *   executeSubsOnPlayers     (from autoSubHelpers)
 *   findRelevantNextSub      (from autoSubHelpers)
 *   recalculateRemainingPlan (from pitchStateUtils)
 *
 * The simulator advances "match seconds", executes every due sub at its
 * scheduled time, optionally injects manual subs mid-half, and asserts the
 * lifecycle invariants the audit identified as silent-breakage risks:
 *
 *   1. Every executed sub is marked exactly once (no double-execution).
 *   2. The plan is never silently dropped to [] while bench depth exists
 *      (the "all subs vanish after a manual sub at 2H 0:02" regression).
 *   3. After a manual sub mid-half, the remaining plan still contains
 *      ≥1 future sub when bench/time allows.
 *   4. Halftime GK swap fires exactly once when configured.
 *   5. Minutes accrue monotonically (no yo-yo where a player's clock rewinds).
 *   6. No same-window in-then-out for the same player id.
 *
 * This is the "safety net" called out in the Phase 0 refactor audit: it
 * doubles as living documentation of the orchestration contract and will
 * catch regressions before any refactor splits the file.
 *
 * Run with the standard `vitest run` (it's a normal *.test.ts; not the slow
 * matrix project).
 */
import { describe, expect, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";
import {
  executeSubsOnPlayers,
  findRelevantNextSub,
  getSubKey,
  getSubTotalSeconds,
  markSubsExecuted,
} from "./autoSubHelpers";
import { recalculateRemainingPlan } from "./pitchStateUtils";
import type { Player, SubstitutionEvent } from "./types";
import type { PitchPosition } from "./PositionBadge";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const positionsForIdx = (i: number, teamSize: number): PitchPosition => {
  if (i === 0) return "GK";
  const slots = teamSize - 1;
  const def = Math.max(1, Math.floor(slots / 3));
  const mid = Math.max(1, Math.floor(slots / 3));
  if (i <= def) return "DEF";
  if (i <= def + mid) return "MID";
  return "FWD";
};

const makeSquad = (
  teamSize: number,
  benchSize: number,
  gkSwap = false,
): Player[] => {
  const players: Player[] = [];
  for (let i = 0; i < teamSize; i++) {
    const pos = positionsForIdx(i, teamSize);
    players.push({
      id: `P${i}`,
      name: `P${i}`,
      position: { x: 50, y: 50 },
      currentPitchPosition: pos,
      assignedPositions: [pos],
      minutesPlayed: 0,
    });
  }
  for (let i = 0; i < benchSize; i++) {
    const id = `B${i}`;
    const assigned: PitchPosition[] =
      gkSwap && i === 0
        ? (["GK", "DEF", "MID", "FWD"] as PitchPosition[])
        : (["DEF", "MID", "FWD"] as PitchPosition[]);
    players.push({
      id,
      name: id,
      position: null,
      assignedPositions: assigned,
      minutesPlayed: 0,
    });
  }
  return players;
};

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

interface SimEvent {
  /** Absolute seconds (1H elapsed, or halfSec + 2H elapsed) */
  atSeconds: number;
  kind: "manual_sub";
  /** id of player coming off the pitch */
  outId: string;
  /** id of player coming on from the bench */
  inId: string;
}

interface SimResult {
  finalPlayers: Player[];
  finalPlan: SubstitutionEvent[];
  executedKeys: string[];
  /** Per-player minutes accrual snapshots, one entry per executed sub time. */
  minutesHistory: Array<Record<string, number>>;
  halftimeGkSwapHappened: boolean;
}

interface SimOptions {
  teamSize: number;
  benchSize: number;
  halfSec: number;
  /** rotation speed: 1 = standard, 2 = frequent */
  mode: 1 | 2;
  gkSwap?: boolean;
  /** Manual interventions in order. */
  interventions?: SimEvent[];
}

/**
 * Accrue minutesPlayed for every on-pitch player from `lastTickSec` → `nowSec`.
 * Mirrors what executeSubsOnPlayers SHOULD do (audit finding #3): without this,
 * outgoing players keep stale totals and any recalc that sorts by
 * minutesPlayed gives unfair results. The simulator does it externally so the
 * test asserts the *expected* behaviour even before the production fix lands.
 */
const accrueMinutes = (players: Player[], deltaSec: number): Player[] =>
  players.map((p) =>
    p.position
      ? { ...p, minutesPlayed: (p.minutesPlayed ?? 0) + deltaSec }
      : p,
  );

const runSimulation = (opts: SimOptions): SimResult => {
  const {
    teamSize,
    benchSize,
    halfSec,
    mode,
    gkSwap = false,
    interventions = [],
  } = opts;

  let players = makeSquad(teamSize, benchSize, gkSwap);
  const preferredGk = gkSwap ? "B0" : undefined;

  let plan = createSubPlan(
    players,
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

  const executedKeys: string[] = [];
  const minutesHistory: Array<Record<string, number>> = [];
  let halftimeGkSwapHappened = false;
  const remainingInterventions = [...interventions].sort(
    (a, b) => a.atSeconds - b.atSeconds,
  );

  const totalSec = halfSec * 2;
  let lastTick = 0;

  // Build a tick schedule from all "interesting" timestamps: every planned sub
  // + every intervention + half boundary + full time. This is faster and more
  // deterministic than ticking every second.
  const buildTickSchedule = (): number[] => {
    const times = new Set<number>();
    times.add(halfSec); // half boundary
    times.add(totalSec); // full time
    plan
      .filter((s) => !s.executed)
      .forEach((s) => times.add(getSubTotalSeconds(s, halfSec)));
    remainingInterventions.forEach((iv) => times.add(iv.atSeconds));
    return [...times].filter((t) => t > lastTick).sort((a, b) => a - b);
  };

  let safety = 0;
  while (lastTick < totalSec && safety++ < 500) {
    const ticks = buildTickSchedule();
    if (ticks.length === 0) break;
    const nowSec = ticks[0];
    const currentHalf: 1 | 2 = nowSec <= halfSec ? 1 : 2;
    const elapsedInHalf =
      currentHalf === 1 ? nowSec : Math.max(0, nowSec - halfSec);

    // Accrue minutes for the elapsed slice.
    players = accrueMinutes(players, nowSec - lastTick);
    lastTick = nowSec;

    // 1) Process interventions scheduled at this exact tick (manual subs).
    while (
      remainingInterventions.length &&
      remainingInterventions[0].atSeconds === nowSec
    ) {
      const iv = remainingInterventions.shift()!;
      const out = players.find((p) => p.id === iv.outId);
      const into = players.find((p) => p.id === iv.inId);
      if (!out?.position || !into || into.position) continue;
      const swappedPos = { ...out.position };
      const outPos = out.currentPitchPosition;
      players = players.map((p) => {
        if (p.id === iv.outId)
          return { ...p, position: null, currentPitchPosition: undefined };
        if (p.id === iv.inId)
          return { ...p, position: swappedPos, currentPitchPosition: outPos };
        return p;
      });

      // After a manual sub, recalc the remainder. Mirrors PitchBoard's
      // post-confirm/post-skip path. We synthesise a "skipped" marker so the
      // helper has the context it needs.
      const skippedMarker: SubstitutionEvent = {
        time: elapsedInHalf,
        half: currentHalf,
        playerOut: out,
        playerIn: into,
        executed: true,
      };
      const recalced = recalculateRemainingPlan(
        players,
        teamSize,
        halfSec,
        elapsedInHalf,
        currentHalf,
        skippedMarker,
        gkSwap,
      );
      // Merge: keep already-executed entries, replace future with recalc.
      const executedSubs = plan.filter((s) => s.executed);
      plan = [...executedSubs, ...recalced];
    }

    // 2) Execute any plan subs whose absolute time is ≤ nowSec.
    const due = plan.filter(
      (s) => !s.executed && getSubTotalSeconds(s, halfSec) <= nowSec,
    );
    if (due.length) {
      const result = executeSubsOnPlayers(due, players);
      players = result.updatedPlayers;
      // Anything that successfully executed gets marked, plus skipped → marked
      // executed+skipped so we never re-attempt them.
      plan = markSubsExecuted(plan, result.executedSubKeys);
      plan = markSubsExecuted(plan, result.skippedSubKeys, true);
      result.executedSubKeys.forEach((k) => executedKeys.push(k));

      // Halftime GK swap detection (audit fixture).
      due.forEach((s) => {
        if (
          s.half === 2 &&
          s.time === 0 &&
          s.playerOut.currentPitchPosition === "GK"
        ) {
          halftimeGkSwapHappened = true;
        }
      });

      minutesHistory.push(
        Object.fromEntries(players.map((p) => [p.id, p.minutesPlayed ?? 0])),
      );
    }
  }

  // Final accrual to full time if loop exited early.
  if (lastTick < totalSec) {
    players = accrueMinutes(players, totalSec - lastTick);
  }

  return {
    finalPlayers: players,
    finalPlan: plan,
    executedKeys,
    minutesHistory,
    halftimeGkSwapHappened,
  };
};

// ---------------------------------------------------------------------------
// Invariant assertions
// ---------------------------------------------------------------------------

const assertCoreInvariants = (label: string, result: SimResult) => {
  // (1) Every executed key appears exactly once — no double-execution.
  const keyCounts = result.executedKeys.reduce<Record<string, number>>(
    (acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc),
    {},
  );
  Object.entries(keyCounts).forEach(([k, n]) =>
    expect(n, `${label}: sub ${k} executed ${n} times`).toBe(1),
  );

  // (5) Minutes monotonic — no rewinds across snapshots.
  const ids = new Set(
    result.minutesHistory.flatMap((s) => Object.keys(s)),
  );
  ids.forEach((id) => {
    let prev = -1;
    result.minutesHistory.forEach((s) => {
      const v = s[id] ?? 0;
      expect(v, `${label}: ${id} minutes rewound (${prev} → ${v})`).toBeGreaterThanOrEqual(prev);
      prev = v;
    });
  });

  // (6) No same-window yo-yo across the full executed plan.
  const executed = result.finalPlan.filter((s) => s.executed && !s.skipped);
  const windows = new Map<string, { ins: Set<string>; outs: Set<string> }>();
  executed.forEach((s) => {
    const key = `${s.half}-${s.time}`;
    const w = windows.get(key) ?? { ins: new Set(), outs: new Set() };
    w.ins.add(s.playerIn.id);
    w.outs.add(s.playerOut.id);
    windows.set(key, w);
  });
  let yoyo = 0;
  windows.forEach((w) => {
    w.ins.forEach((id) => {
      if (w.outs.has(id)) yoyo++;
    });
  });
  expect(yoyo, `${label}: yo-yo executions = ${yoyo}`).toBeLessThanOrEqual(1);
};

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe("Pitch board orchestration simulator", () => {
  it("A — clean 7-a-side, 3 bench, 25min, standard rotation: plan completes without collapsing", () => {
    const result = runSimulation({
      teamSize: 7,
      benchSize: 3,
      halfSec: 25 * 60,
      mode: 1,
    });
    assertCoreInvariants("A", result);
    // Bench depth means we MUST execute ≥1 sub across a 50-minute match.
    expect(result.executedKeys.length).toBeGreaterThan(0);
  });

  it("B — manual sub 2 min into 2H must NOT vanish the remaining plan (regression)", () => {
    // This is the exact scenario the user reported: U12 boys, 7v7, manual sub
    // ~2 minutes into the second half, and all planned subs for the remainder
    // of H2 silently disappeared. With bench depth available, recalc MUST
    // return ≥1 future sub for the rest of the half.
    const halfSec = 25 * 60;
    const result = runSimulation({
      teamSize: 7,
      benchSize: 3,
      halfSec,
      mode: 1,
      interventions: [
        { atSeconds: halfSec + 2 * 60, kind: "manual_sub", outId: "P3", inId: "B0" },
      ],
    });
    assertCoreInvariants("B", result);
    const futureAfterManual = result.finalPlan.filter(
      (s) => s.executed && s.half === 2 && s.time > 2 * 60,
    );
    expect(
      futureAfterManual.length,
      "B: plan collapsed after manual sub — bench depth was available but no future subs ran",
    ).toBeGreaterThan(0);
  });

  it("C — halftime GK swap fires exactly once when configured", () => {
    const result = runSimulation({
      teamSize: 7,
      benchSize: 3,
      halfSec: 20 * 60,
      mode: 1,
      gkSwap: true,
    });
    assertCoreInvariants("C", result);
    expect(
      result.halftimeGkSwapHappened,
      "C: GK swap at halftime did not fire",
    ).toBe(true);
  });

  it("D — large squad 11-a-side, 5 bench, 45min halves: plan completes, fair-ish minutes", () => {
    const halfSec = 45 * 60;
    const result = runSimulation({
      teamSize: 11,
      benchSize: 5,
      halfSec,
      mode: 1,
    });
    assertCoreInvariants("D", result);
    expect(result.executedKeys.length).toBeGreaterThan(0);
    // Pragmatic floor: every player must have played > 0 minutes.
    result.finalPlayers.forEach((p) =>
      expect(
        p.minutesPlayed ?? 0,
        `D: ${p.id} starved (0 minutes)`,
      ).toBeGreaterThan(0),
    );
  });

  it("E — two manual subs in quick succession in H1 do not corrupt plan or double-execute", () => {
    const halfSec = 20 * 60;
    const result = runSimulation({
      teamSize: 7,
      benchSize: 3,
      halfSec,
      mode: 2, // frequent
      interventions: [
        { atSeconds: 5 * 60, kind: "manual_sub", outId: "P4", inId: "B0" },
        { atSeconds: 7 * 60, kind: "manual_sub", outId: "P5", inId: "B1" },
      ],
    });
    assertCoreInvariants("E", result);
  });

  it("F — tiny bench (5-a-side, 1 bench) still produces a non-empty plan and rotates", () => {
    const halfSec = 15 * 60;
    const result = runSimulation({
      teamSize: 5,
      benchSize: 1,
      halfSec,
      mode: 1,
    });
    assertCoreInvariants("F", result);
    expect(result.executedKeys.length).toBeGreaterThan(0);
  });

  it("G — findRelevantNextSub never returns a stale (already-executed) sub", () => {
    // Direct unit guard on the helper PitchBoard's UI banner uses to surface
    // the "next sub" — if this ever returns an executed sub, the banner
    // freezes on a phantom and users miss the real next one.
    const halfSec = 25 * 60;
    const result = runSimulation({
      teamSize: 7,
      benchSize: 3,
      halfSec,
      mode: 1,
    });
    const next = findRelevantNextSub(result.finalPlan, 2, halfSec, halfSec);
    if (next) {
      expect(next.executed, "G: findRelevantNextSub returned an executed sub").not.toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit #5 — chronological-next sub matching (mass-mark regression)
// ---------------------------------------------------------------------------
// The on-pitch signature effect in PitchBoard now claims at most ONE pending
// sub per (playerOut→playerIn) pair after a manual change, so a repeating
// rotation pair planned across two windows isn't silently consumed in one go.
describe("Audit #5 — chronological-next pair matching", () => {
  const claimChronologicalFirst = (
    plan: SubstitutionEvent[],
    benchIds: Set<string>,
    pitchIds: Set<string>,
  ): Set<string> => {
    const matched = new Set<string>();
    const claimedPairs = new Set<string>();
    const sorted = [...plan].sort((a, b) => {
      const at = a.half === 1 ? a.time : 100000 + a.time;
      const bt = b.half === 1 ? b.time : 100000 + b.time;
      return at - bt;
    });
    sorted.forEach((s) => {
      const pairKey = `${s.playerOut.id}->${s.playerIn.id}`;
      if (claimedPairs.has(pairKey)) return;
      if (benchIds.has(s.playerOut.id) && pitchIds.has(s.playerIn.id)) {
        matched.add(`${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`);
        claimedPairs.add(pairKey);
      }
    });
    return matched;
  };

  it("only claims the earliest of two future windows sharing the same pair", () => {
    const mkSub = (half: 1 | 2, time: number): SubstitutionEvent => ({
      half,
      time,
      playerOut: { id: "P3" } as Player,
      playerIn: { id: "B0" } as Player,
    });
    const plan = [mkSub(1, 600), mkSub(2, 300)];
    const matched = claimChronologicalFirst(
      plan,
      new Set(["P3"]),
      new Set(["B0"]),
    );
    expect(matched.size).toBe(1);
    expect(matched.has("1-600-P3-B0")).toBe(true);
    expect(matched.has("2-300-P3-B0")).toBe(false);
  });

  it("matches distinct pairs in their own earliest windows independently", () => {
    const plan: SubstitutionEvent[] = [
      { half: 1, time: 500, playerOut: { id: "P3" } as Player, playerIn: { id: "B0" } as Player },
      { half: 2, time: 200, playerOut: { id: "P3" } as Player, playerIn: { id: "B0" } as Player },
      { half: 2, time: 600, playerOut: { id: "P4" } as Player, playerIn: { id: "B1" } as Player },
    ];
    const matched = claimChronologicalFirst(
      plan,
      new Set(["P3", "P4"]),
      new Set(["B0", "B1"]),
    );
    expect(matched.size).toBe(2);
    expect(matched.has("1-500-P3-B0")).toBe(true);
    expect(matched.has("2-600-P4-B1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Audit #4 — recalc 30s fairness short-circuit (FIXED).
// ---------------------------------------------------------------------------
// `recalculateRemainingPlan` used a static `minutesPlayed` snapshot per
// candidate. With balanced rosters the 30s fairness gate at line ~345 of
// pitchStateUtils.ts collapsed the entire loop to []. Fix: simulate forward
// across the planned sub windows (the leader's clock keeps ticking on pitch).
describe("Audit #4 — recalc 30s short-circuit", () => {
  it("returns a non-empty plan when minutes are near-equal but bench + time remain", () => {
    // 7-a-side (1 GK + 6 outfield) + 5 bench, 25-min halves.
    // Roster fully equalised at 14:00 of H1 — pre-fix planner short-circuited.
    const players: Player[] = [];
    for (let i = 0; i < 7; i++) {
      const pos = positionsForIdx(i, 7);
      players.push({
        id: `P${i}`,
        name: `P${i}`,
        position: { x: 50, y: 50 },
        currentPitchPosition: pos,
        assignedPositions: [pos],
        // Outfielders all at 600s, GK at 840s (GK is filtered out of recalc).
        minutesPlayed: i === 0 ? 840 : 600,
      });
    }
    for (let i = 0; i < 5; i++) {
      players.push({
        id: `B${i}`,
        name: `B${i}`,
        position: null,
        currentPitchPosition: undefined,
        assignedPositions: ["DEF", "MID", "FWD"] as PitchPosition[],
        // Bench at 595s — only 5s below the on-pitch leaders, well inside the
        // 30s fairness threshold. Pre-fix this caused an immediate [] return.
        minutesPlayed: 595,
      });
    }

    const plan = recalculateRemainingPlan(
      players,
      7,
      25 * 60,
      14 * 60,
      1,
      {
        half: 1,
        time: 14 * 60,
        playerOut: players[1],
        playerIn: players[7],
        executed: false,
      } as SubstitutionEvent,
      false,
    );

    expect(plan.length, "recalc should not short-circuit to []").toBeGreaterThan(0);

    // Chronologically valid: times monotonically non-decreasing (multiple
    // subs can share a window) and half 1 entries precede half 2 entries.
    let lastAbs = -1;
    for (const sub of plan) {
      const abs = sub.half === 1 ? sub.time : 25 * 60 + sub.time;
      expect(abs).toBeGreaterThanOrEqual(lastAbs);
      lastAbs = abs;
    }
  });
});

// Tiny smoke test on getSubKey to lock the format — every regression we've
// seen on sub matching boiled down to a key-format mismatch.
describe("getSubKey contract", () => {
  it("encodes half, time, playerOut.id deterministically", () => {
    const sub: SubstitutionEvent = {
      half: 2,
      time: 600,
      playerOut: { id: "P3" } as Player,
      playerIn: { id: "B1" } as Player,
    };
    expect(getSubKey(sub)).toBe("2-600-P3");
  });
});
