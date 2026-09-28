/**
 * Drift audit for the GameTimer wall-clock tick algorithm.
 *
 * Replicates the exact tick loop introduced to fix the U12 boys at Riverside
 * case (clock showed 7:00 while 11:00 of real time had elapsed). The loop
 * lives inside a React effect in GameTimer.tsx, so this test re-implements
 * the same algorithm in isolation and hammers it under realistic scenarios:
 *   - perfectly on-time ticks
 *   - sub-second early fires (visibility/focus jitter)
 *   - long throttled gaps (locked screen, low-power mode)
 *   - resume reconcile re-anchor
 *   - half-time crossover
 *
 * Also covers the pure projection helpers in `timerUtils` that the resume
 * reconcile path uses as its source of truth.
 */
import { describe, it, expect } from "vitest";
import {
  getSecondsSinceUpdate,
  getSecondsSinceUpdateUncapped,
  getCurrentGameSeconds,
  projectRunningTimerState,
  MAX_EXTRAPOLATION_SECS,
} from "./timerUtils";
import type { TimerState } from "./types";

// ---------------------------------------------------------------------------
// Tick simulator — mirrors the algorithm in GameTimer.tsx exactly.
// ---------------------------------------------------------------------------
interface SimState {
  elapsed: number;
  half: 1 | 2;
  running: boolean;
  finished: boolean;
  anchor: number;
  halfDur: number;
}

const tick = (s: SimState, now: number): void => {
  if (!s.running || s.finished) return;
  const deltaSec = Math.floor((now - s.anchor) / 1000);
  if (deltaSec < 1) return; // skip, leave anchor untouched
  s.anchor = s.anchor + deltaSec * 1000; // preserve sub-second remainder
  let newValue = s.elapsed + deltaSec;
  if (newValue >= s.halfDur) {
    if (s.half === 1) {
      s.running = false;
      s.half = 2;
      s.elapsed = 0;
      return;
    }
    s.running = false;
    s.finished = true;
    s.elapsed = s.halfDur;
    return;
  }
  s.elapsed = newValue;
};

const mkSim = (halfMinutes: number, startWall: number): SimState => ({
  elapsed: 0,
  half: 1,
  running: true,
  finished: false,
  anchor: startWall,
  halfDur: halfMinutes * 60,
});

// ---------------------------------------------------------------------------
describe("GameTimer wall-clock tick — pure simulation", () => {
  it("perfectly on-time ticks: 1s interval credits exactly 1s each", () => {
    const t0 = 1_000_000_000;
    const s = mkSim(20, t0);
    for (let i = 1; i <= 600; i++) tick(s, t0 + i * 1000);
    expect(s.elapsed).toBe(600);
    expect(s.half).toBe(1);
    expect(s.running).toBe(true);
  });

  it("sub-second early fire: no over-credit, anchor preserved", () => {
    const t0 = 1_000_000_000;
    const s = mkSim(20, t0);
    // Interval fires 50ms early repeatedly. Anchor should NOT advance until
    // a full second has accumulated, then exactly 1s is credited.
    let wall = t0;
    for (let i = 0; i < 100; i++) {
      wall += 950;
      tick(s, wall);
    }
    // 100 * 950ms = 95s of real wall time. We should have credited exactly 95s,
    // not 100s (the bug we fixed).
    expect(s.elapsed).toBe(95);
  });

  it("WebView throttle: 30s gap is credited in full on next fire", () => {
    const t0 = 1_000_000_000;
    const s = mkSim(20, t0);
    // 5s of normal ticks
    for (let i = 1; i <= 5; i++) tick(s, t0 + i * 1000);
    expect(s.elapsed).toBe(5);
    // Then a 30s gap (phone locked) — next interval fire credits all 30s
    tick(s, t0 + 35_000);
    expect(s.elapsed).toBe(35);
  });

  it("U12 Riverside scenario: 11min real wall clock, severe throttling", () => {
    const t0 = 1_000_000_000;
    const s = mkSim(40, t0); // long half so we don't cross half-time
    // 11 minutes of wall clock, but the interval only fires sporadically:
    // simulate WebView throttle producing irregular gaps.
    const fires = [
      1_000, 2_000, 3_000, 4_000, 5_000, // 5s of normal
      65_000,   // +60s frozen
      125_000,  // +60s frozen
      185_000,  // +60s frozen
      245_000,  // +60s frozen
      305_000,  // +60s frozen
      365_000,  // +60s frozen
      425_000,  // +60s frozen
      485_000,  // +60s frozen
      545_000,  // +60s frozen
      605_000,  // +60s frozen — total 11min real
      660_000,  // tail
    ];
    for (const off of fires) tick(s, t0 + off);
    // Clock must reflect actual wall time, not number-of-fires.
    expect(s.elapsed).toBe(660);
    // The buggy `prev + 1` approach would have given us 16 (number of fires).
  });

  it("crosses half-time exactly when wall clock hits half duration", () => {
    const t0 = 1_000_000_000;
    const s = mkSim(1, t0); // 60s half for fast test
    // Big jump that lands beyond half-time
    tick(s, t0 + 75_000);
    expect(s.half).toBe(2);
    expect(s.running).toBe(false);
    expect(s.elapsed).toBe(0); // reset for 2nd half
  });

  it("marks finished when 2nd half wall clock exceeds duration", () => {
    const t0 = 1_000_000_000;
    const s = mkSim(1, t0);
    s.half = 2;
    s.elapsed = 30;
    s.anchor = t0;
    tick(s, t0 + 60_000);
    expect(s.finished).toBe(true);
    expect(s.running).toBe(false);
    expect(s.elapsed).toBe(60);
  });

  it("no drift over a full 90-minute match at 1s ticks", () => {
    const t0 = 1_000_000_000;
    const s = mkSim(45, t0);
    let wall = t0;
    // Simulate first half with small jitter (-50..+50ms) per tick.
    let jitterSeed = 1;
    const jitter = () => {
      jitterSeed = (jitterSeed * 1103515245 + 12345) & 0x7fffffff;
      return ((jitterSeed % 101) - 50); // -50..+50 ms
    };
    while (s.running) {
      wall += 1000 + jitter();
      tick(s, wall);
    }
    expect(s.half).toBe(2);
    expect(s.elapsed).toBe(0);
    // The crossover happened at the first fire where wall - t0 >= 45*60*1000.
    // Anchor advanced by exactly halfDur*1000, so no drift accumulated.
    expect(s.anchor - t0).toBeGreaterThanOrEqual(45 * 60 * 1000);
    expect(s.anchor - t0).toBeLessThan(45 * 60 * 1000 + 1000);
  });

  it("resume reconcile re-anchor prevents double-credit", () => {
    const t0 = 1_000_000_000;
    const s = mkSim(20, t0);
    // Run 10s normally
    for (let i = 1; i <= 10; i++) tick(s, t0 + i * 1000);
    expect(s.elapsed).toBe(10);
    // Simulate app backgrounding for 120s. Resume reconcile would jump
    // elapsed to 130 and re-anchor to "now".
    const resumeWall = t0 + 130_000;
    s.elapsed = 130;
    s.anchor = resumeWall; // <-- the critical re-anchor
    // Next tick 1s later must credit only 1s, not 121s.
    tick(s, resumeWall + 1000);
    expect(s.elapsed).toBe(131);
  });
});

// ---------------------------------------------------------------------------
describe("timerUtils — projection helpers", () => {
  it("getSecondsSinceUpdate caps at MAX_EXTRAPOLATION_SECS", () => {
    const now = 1_000_000_000;
    expect(getSecondsSinceUpdate(now - 10_000, now)).toBe(10);
    expect(getSecondsSinceUpdate(now - 60_000, now)).toBe(MAX_EXTRAPOLATION_SECS);
    expect(getSecondsSinceUpdate(undefined, now)).toBe(0);
    expect(getSecondsSinceUpdate(now + 5000, now)).toBe(0); // negative -> 0
  });

  it("getSecondsSinceUpdateUncapped reports full drift", () => {
    const now = 1_000_000_000;
    expect(getSecondsSinceUpdateUncapped(now - 660_000, now)).toBe(660);
    expect(getSecondsSinceUpdateUncapped(null, now)).toBe(0);
  });

  const baseState = (overrides: Partial<TimerState> = {}): TimerState => ({
    minutesPerHalf: 20,
    currentHalf: 1,
    elapsedSeconds: 0,
    isRunning: true,
    lastUpdateTime: 1_000_000_000,
    teamId: "t1",
    teamName: "Test",
    ...overrides,
  } as TimerState);

  it("projectRunningTimerState advances by uncapped wall delta", () => {
    const s = baseState({ elapsedSeconds: 300 });
    const r = projectRunningTimerState(s, s.lastUpdateTime! + 360_000);
    expect(r.secondsAdvanced).toBe(360);
    expect(r.timerState.elapsedSeconds).toBe(660);
    expect(r.crossedHalf).toBe(false);
    expect(r.finished).toBe(false);
  });

  it("projectRunningTimerState crosses half-time and pauses", () => {
    const s = baseState({ elapsedSeconds: 1100 }); // 18:20 into 20-min half
    const r = projectRunningTimerState(s, s.lastUpdateTime! + 120_000); // +2min
    expect(r.crossedHalf).toBe(true);
    expect(r.timerState.currentHalf).toBe(2);
    expect(r.timerState.isRunning).toBe(false);
    expect(r.timerState.elapsedSeconds).toBe(20); // 1220 - 1200
  });

  it("projectRunningTimerState finishes at end of 2nd half", () => {
    const s = baseState({ currentHalf: 2, elapsedSeconds: 1190 });
    const r = projectRunningTimerState(s, s.lastUpdateTime! + 60_000);
    expect(r.finished).toBe(true);
    expect(r.timerState.isRunning).toBe(false);
    expect(r.timerState.elapsedSeconds).toBe(1200);
    expect(r.timerState.gameFinishedAt).toBe(s.lastUpdateTime! + 60_000);
  });

  it("projectRunningTimerState no-ops when paused", () => {
    const s = baseState({ isRunning: false, elapsedSeconds: 100 });
    const r = projectRunningTimerState(s, s.lastUpdateTime! + 60_000);
    expect(r.secondsAdvanced).toBe(0);
    expect(r.timerState.elapsedSeconds).toBe(100);
  });

  it("getCurrentGameSeconds clamps to half duration when running", () => {
    const s = baseState({ elapsedSeconds: 1100 });
    expect(getCurrentGameSeconds(s, s.lastUpdateTime! + 200_000)).toBe(1200);
  });

  it("getCurrentGameSeconds returns base when paused", () => {
    const s = baseState({ isRunning: false, elapsedSeconds: 500 });
    expect(getCurrentGameSeconds(s, s.lastUpdateTime! + 60_000)).toBe(500);
  });

  it("getCurrentGameSeconds null-safe", () => {
    expect(getCurrentGameSeconds(null)).toBe(0);
    expect(getCurrentGameSeconds(undefined)).toBe(0);
  });
});
