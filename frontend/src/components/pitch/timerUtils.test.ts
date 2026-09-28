import { describe, expect, it } from "vitest";
import { getCurrentGameSeconds, getSecondsSinceUpdate, getSecondsSinceUpdateUncapped, projectRunningTimerState } from "./timerUtils";

const base: any = { minutesPerHalf: 45, currentHalf: 1, elapsedSeconds: 0, isRunning: true, lastUpdateTime: 1_000 };

describe("timerUtils", () => {
  it("clamps visual extrapolation to 30 seconds and never goes negative", () => {
    expect(getSecondsSinceUpdate(1_000, 101_000)).toBe(30);
    expect(getSecondsSinceUpdate(2_000, 1_000)).toBe(0);
    expect(getSecondsSinceUpdate(null, 5_000)).toBe(0);
  });

  it("uses uncapped wall-clock time for authoritative resume", () => {
    expect(getSecondsSinceUpdateUncapped(1_000, 101_000)).toBe(100);
    expect(getSecondsSinceUpdateUncapped(2_000, 1_000)).toBe(0);
  });

  it("projects an ordinary running timer", () => {
    const out = projectRunningTimerState({ ...base, elapsedSeconds: 60 }, 11_000);
    expect(out).toMatchObject({ secondsAdvanced: 10, crossedHalf: false, finished: false });
    expect(out.timerState).toMatchObject({ currentHalf: 1, elapsedSeconds: 70, isRunning: true, lastUpdateTime: 11_000 });
  });

  it("crosses half time, carries overflow and pauses", () => {
    const out = projectRunningTimerState({ ...base, elapsedSeconds: 2695 }, 11_000);
    expect(out).toMatchObject({ crossedHalf: true, finished: false });
    expect(out.timerState).toMatchObject({ currentHalf: 2, elapsedSeconds: 5, isRunning: false });
  });

  it("finishes and clamps the second half with a finish timestamp", () => {
    const out = projectRunningTimerState({ ...base, currentHalf: 2, elapsedSeconds: 2695 }, 11_000);
    expect(out.finished).toBe(true);
    expect(out.timerState).toMatchObject({ elapsedSeconds: 2700, isRunning: false, isGameFinished: true, gameFinishedAt: 11_000 });
  });

  it("preserves an existing finish timestamp", () => {
    const out = projectRunningTimerState({ ...base, currentHalf: 2, elapsedSeconds: 2700, isGameFinished: true, gameFinishedAt: 123 }, 11_000);
    expect(out.timerState.gameFinishedAt).toBe(123);
    expect(out.secondsAdvanced).toBe(0);
  });

  it("does not advance paused or invalid-duration timers", () => {
    expect(projectRunningTimerState({ ...base, isRunning: false }, 11_000).secondsAdvanced).toBe(0);
    expect(projectRunningTimerState({ ...base, minutesPerHalf: 0 }, 11_000).secondsAdvanced).toBe(0);
  });

  it("returns current seconds clamped to the half duration", () => {
    expect(getCurrentGameSeconds(null, 11_000)).toBe(0);
    expect(getCurrentGameSeconds({ ...base, elapsedSeconds: 100, isRunning: false }, 11_000)).toBe(100);
    expect(getCurrentGameSeconds({ ...base, elapsedSeconds: 2695 }, 11_000)).toBe(2700);
    expect(getCurrentGameSeconds({ ...base, elapsedSeconds: 4000, isRunning: false }, 11_000)).toBe(2700);
  });
});
