import { describe, it, expect } from "vitest";
import {
  isMeaningfulTimerState,
  projectLocalElapsed,
  shouldApplyRemoteTimerState,
  type LocalEventGroupTimer,
} from "./eventGroupTimerGuard";

const live: LocalEventGroupTimer = {
  elapsedSeconds: 16 * 60,
  currentHalf: 1,
  isRunning: true,
  lastUpdateTime: Date.now() - 1000,
};

describe("isMeaningfulTimerState", () => {
  it("rejects the event_groups.timer_state default and id-only payloads", () => {
    expect(isMeaningfulTimerState({})).toBe(false);
    expect(isMeaningfulTimerState({ teamId: "event-group-x" })).toBe(false);
    expect(isMeaningfulTimerState(null)).toBe(false);
    expect(isMeaningfulTimerState([])).toBe(false);
  });

  it("accepts a real clock payload", () => {
    expect(isMeaningfulTimerState({ elapsedSeconds: 0, isRunning: false })).toBe(true);
  });
});

describe("projectLocalElapsed", () => {
  it("adds drift while running", () => {
    const v = projectLocalElapsed({ elapsedSeconds: 60, isRunning: true, lastUpdateTime: Date.now() - 30_000 });
    expect(v).toBeGreaterThanOrEqual(89);
  });

  it("does not drift while paused", () => {
    expect(projectLocalElapsed({ elapsedSeconds: 60, isRunning: false, lastUpdateTime: Date.now() - 30_000 })).toBe(60);
  });
});

describe("shouldApplyRemoteTimerState", () => {
  it("never applies an empty DB row over a live board (the reset-to-0 defect)", () => {
    const d = shouldApplyRemoteTimerState({ remote: {}, local: live, force: true });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("remote-not-meaningful");
  });

  it("never applies a stale peer snapshot that would rewind the clock", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 0, currentHalf: 1, isRunning: false, lastUpdateTime: Date.now() - 60_000 },
      local: live,
      force: true,
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("would-regress-clock");
  });

  it("rejects a stale pause that would freeze a running board", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 16 * 60, currentHalf: 1, isRunning: false, lastUpdateTime: Date.now() - 60_000 },
      local: live,
      force: true,
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("stale-remote-pause");
  });

  it("applies a genuine newer pause from a peer", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 16 * 60, currentHalf: 1, isRunning: false, lastUpdateTime: Date.now() + 1000 },
      local: live,
      force: true,
    });
    expect(d.apply).toBe(true);
  });

  it("applies a peer that is ahead in the same half", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 20 * 60, currentHalf: 1, isRunning: true, lastUpdateTime: Date.now() },
      local: live,
      force: true,
    });
    expect(d.apply).toBe(true);
  });

  it("applies a half-time / 2nd-half transition from a peer", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 0, currentHalf: 2, isRunning: false, lastUpdateTime: Date.now() },
      local: live,
      force: true,
    });
    expect(d.apply).toBe(true);
    expect(d.reason).toBe("remote-newer-half");
  });

  it("applies full time even when local is mid-clock", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 40 * 60, currentHalf: 1, isRunning: false, isGameFinished: true, lastUpdateTime: Date.now() },
      local: live,
      force: true,
    });
    expect(d.apply).toBe(true);
  });

  it("hydrates when there is no local board", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 300, currentHalf: 1, isRunning: true, lastUpdateTime: Date.now() },
      local: null,
      force: false,
    });
    expect(d.apply).toBe(true);
  });

  it("does not clobber an existing local board on initial (non-forced) load", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 300, currentHalf: 1, isRunning: true, lastUpdateTime: Date.now() },
      local: live,
      force: false,
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("local-state-present");
  });

  it("rejects an older half from a peer", () => {
    const d = shouldApplyRemoteTimerState({
      remote: { elapsedSeconds: 100, currentHalf: 1, isRunning: true, lastUpdateTime: Date.now() },
      local: { ...live, currentHalf: 2, elapsedSeconds: 10 },
      force: true,
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("remote-older-half");
  });
});
