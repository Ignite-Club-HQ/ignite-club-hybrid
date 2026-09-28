import { describe, expect, it } from "vitest";
import {
  deriveElapsedSeconds,
  hasAnchoredTimerMarker,
  isServerAnchoredTimer,
  isServerTimerEligibleTeamId,
  mayWriteLegacyTimerState,
  shouldAcceptServerSnapshot,
  shouldPreferLocalOnFirstHydrate,
  type LocalTimerSnapshot,
  type ServerTimer,
} from "@/lib/serverTimer";
import { projectRunningTimerState } from "./timerUtils";

const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);
const iso = (offsetSeconds = 0) => new Date(T0 + offsetSeconds * 1000).toISOString();
const anchored = (overrides: Partial<ServerTimer> = {}): ServerTimer => ({
  schema_version: 2,
  current_half: 1,
  minutes_per_half: 40,
  half_started_at: iso(),
  half_paused_at: null,
  accumulated_pause_ms: 0,
  is_running: true,
  is_game_finished: false,
  half_ended_at: null,
  last_event_at: iso(),
  ...overrides,
});
const local = (overrides: Partial<LocalTimerSnapshot> = {}): LocalTimerSnapshot => ({
  isRunning: true,
  currentHalf: 1,
  elapsedSeconds: 16 * 60,
  isGameFinished: false,
  ...overrides,
});

describe("pitch timer resilience matrix", () => {
  describe.each([5, 10, 20, 40, 45, 60])("%i-minute halves", (minutes) => {
    it("derives exact progress and clamps at the half boundary", () => {
      const value = anchored({ minutes_per_half: minutes });
      const midpoint = Math.floor(minutes * 30);
      expect(deriveElapsedSeconds(value, T0 + midpoint * 1000)).toBe(midpoint);
      expect(deriveElapsedSeconds(value, T0 + (minutes * 60 + 300) * 1000)).toBe(minutes * 60);
    });
  });

  it("preserves sub-second precision without ever over-crediting", () => {
    const value = anchored();
    expect(deriveElapsedSeconds(value, T0 + 999)).toBe(0);
    expect(deriveElapsedSeconds(value, T0 + 1_999)).toBe(1);
  });

  it("subtracts several accumulated lock/pause periods exactly once", () => {
    const value = anchored({ accumulated_pause_ms: 7 * 60_000 + 15_000 });
    expect(deriveElapsedSeconds(value, T0 + 23 * 60_000 + 15_000)).toBe(16 * 60);
  });

  it("uses the pause instant even when the device resumes hours later", () => {
    const value = anchored({ is_running: false, half_paused_at: iso(16 * 60) });
    expect(deriveElapsedSeconds(value, T0 + 8 * 60 * 60_000)).toBe(16 * 60);
  });

  it("does not credit time when the server clock precedes the half start", () => {
    expect(deriveElapsedSeconds(anchored({ half_started_at: iso(30) }), T0)).toBe(0);
  });

  it("keeps team, personal and synthetic event-group timer domains isolated", () => {
    expect(isServerTimerEligibleTeamId("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isServerTimerEligibleTeamId(null)).toBe(true);
    expect(isServerTimerEligibleTeamId("event-group-00000000-0000-4000-8000-000000000001")).toBe(false);
    expect(isServerTimerEligibleTeamId("team-a")).toBe(false);
  });

  it("recognises a clobbered v2 marker but never treats it as a readable anchored row", () => {
    const clobbered = { schema_version: 2, elapsedSeconds: 960, isRunning: true, lastUpdateTime: T0 };
    expect(hasAnchoredTimerMarker(clobbered)).toBe(true);
    expect(isServerAnchoredTimer(clobbered)).toBe(false);
  });

  it.each([
    [{ schema_version: 2 }, null],
    [null, { schema_version: 2 }],
    [{ schema_version: 2 }, { schema_version: 1 }],
  ])("blocks a legacy writer when either local or remote owns the v2 marker", (localState, remoteState) => {
    expect(mayWriteLegacyTimerState({ local: localState, remote: remoteState })).toBe(false);
  });

  it("allows legacy timer persistence only when neither side is anchored", () => {
    expect(mayWriteLegacyTimerState({
      local: { elapsedSeconds: 120, schema_version: 1 },
      remote: { elapsedSeconds: 118 },
    })).toBe(true);
  });

  it("rejects a stale response after a newer pause has already won", () => {
    const acceptedPause = anchored({
      is_running: false,
      half_paused_at: iso(16 * 60),
      last_event_at: iso(16 * 60),
    });
    const lateRunningRead = anchored({ last_event_at: iso(15 * 60) });
    const decision = shouldAcceptServerSnapshot(acceptedPause, lateRunningRead, local({ isRunning: false }));
    expect(decision.accept).toBe(false);
    expect(decision.reason).toMatch(/older|regress/);
  });

  it("rejects divergent state with an identical event timestamp", () => {
    const previous = anchored({ last_event_at: iso(16 * 60) });
    const divergent = anchored({
      last_event_at: iso(16 * 60),
      is_running: false,
      half_paused_at: iso(16 * 60),
    });
    expect(shouldAcceptServerSnapshot(previous, divergent, local()).reason)
      .toBe("divergent-state-at-equal-timestamp");
  });

  it("accepts newer reset, halftime and full-time decisions as authoritative", () => {
    const previous = anchored({ last_event_at: iso(16 * 60) });
    const states = [
      anchored({ half_started_at: null, is_running: false, last_event_at: iso(16 * 60 + 1) }),
      anchored({ current_half: 2, is_running: false, last_event_at: iso(16 * 60 + 1) }),
      anchored({ current_half: 2, is_running: false, is_game_finished: true, last_event_at: iso(16 * 60 + 1) }),
    ];
    for (const state of states) {
      expect(shouldAcceptServerSnapshot(previous, state, local()).accept).toBe(true);
    }
  });

  it("prefers a newer server event even when a local projection is further ahead", () => {
    expect(shouldPreferLocalOnFirstHydrate({
      incoming: anchored({ last_event_at: iso(17 * 60) }),
      serverNowMs: T0 + 17 * 60_000,
      localElapsedSeconds: 20 * 60,
      localCurrentHalf: 1,
      localIsRunning: true,
      localLastUpdateMs: T0 + 16 * 60_000,
    })).toBe(false);
  });

  it("keeps a newer local projection when an old server row would rewind the same half", () => {
    expect(shouldPreferLocalOnFirstHydrate({
      incoming: anchored({ is_running: false, half_paused_at: iso(10 * 60), last_event_at: iso(10 * 60) }),
      serverNowMs: T0 + 20 * 60_000,
      localElapsedSeconds: 16 * 60,
      localCurrentHalf: 1,
      localIsRunning: true,
      localLastUpdateMs: T0 + 16 * 60_000,
    })).toBe(true);
  });

  it("carries first-half overflow once and deliberately pauses at halftime", () => {
    const projected = projectRunningTimerState({
      minutesPerHalf: 40,
      currentHalf: 1 as const,
      elapsedSeconds: 39 * 60 + 50,
      isRunning: true,
      lastUpdateTime: T0,
    }, T0 + 25_000);
    expect(projected.secondsAdvanced).toBe(25);
    expect(projected.crossedHalf).toBe(true);
    expect(projected.timerState).toMatchObject({ currentHalf: 2, elapsedSeconds: 15, isRunning: false });
  });

  it("clamps a large second-half resume jump at full time", () => {
    const projected = projectRunningTimerState({
      minutesPerHalf: 40,
      currentHalf: 2 as const,
      elapsedSeconds: 39 * 60,
      isRunning: true,
      lastUpdateTime: T0,
    }, T0 + 20 * 60_000);
    expect(projected.finished).toBe(true);
    expect(projected.timerState).toMatchObject({ elapsedSeconds: 40 * 60, isRunning: false, isGameFinished: true });
  });
});
