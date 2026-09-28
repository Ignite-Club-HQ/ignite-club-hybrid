/**
 * Lifecycle regression tests for the pitch GameTimer.
 *
 * The failure being guarded against: a stale server snapshot arriving on
 * resume must never move an active game timer backwards. The offending path
 * was `applyServerSnapshot` unconditionally overwriting local state with
 * whatever `pitch-timer-read` returned — including a stale zero-minute
 * response returned during a resume/visibility/focus refresh.
 *
 * These tests exercise the guard function `shouldAcceptServerSnapshot`
 * which is the single source of truth used by GameTimer to accept or
 * reject an incoming ServerTimer. Testing the guard directly is preferred
 * over mounting the full component because GameTimer depends on Capacitor,
 * WakeLock, notifications and Supabase — none of which are available in
 * jsdom without extensive mocking.
 */
import { describe, it, expect } from "vitest";
import { shouldAcceptServerSnapshot, type ServerTimer, type LocalTimerSnapshot } from "@/lib/serverTimer";

const HYDRATED_AT_16_MIN: LocalTimerSnapshot = {
  isRunning: true,
  currentHalf: 1,
  elapsedSeconds: 16 * 60,
  isGameFinished: false,
};

const snapshotAt = (iso: string, running = true): ServerTimer => ({
  schema_version: 2,
  current_half: 1,
  minutes_per_half: 40,
  half_started_at: running ? "2026-07-25T09:44:00.000Z" : null,
  half_paused_at: null,
  accumulated_pause_ms: 0,
  is_running: running,
  is_game_finished: false,
  half_ended_at: null,
  last_event_at: iso,
});

const zeroSnapshotAt = (iso: string): ServerTimer => ({
  schema_version: 2,
  current_half: 1,
  minutes_per_half: 40,
  half_started_at: null,
  half_paused_at: null,
  accumulated_pause_ms: 0,
  is_running: false,
  is_game_finished: false,
  half_ended_at: null,
  last_event_at: iso,
});

describe("GameTimer lifecycle — stale server snapshot handling", () => {
  it("must never move a live timer backwards when a resume read returns a stale zero snapshot", () => {
    // The real GameTimer hydrates at 16:00 from a running server snapshot.
    const accepted = snapshotAt("2026-07-25T10:00:00.000Z", true);
    // A resume/visibility/focus refresh returns a stale zero-minute server
    // snapshot (older last_event_at than the hydrated one).
    const staleZero = zeroSnapshotAt("2026-07-25T09:59:00.000Z");
    const decision = shouldAcceptServerSnapshot(accepted, staleZero, HYDRATED_AT_16_MIN);
    expect(decision.accept).toBe(false);
  });

  it("an out-of-order response with a stale last_event_at is dropped", () => {
    const accepted = snapshotAt("2026-07-25T10:05:00.000Z", true);
    const outOfOrder = snapshotAt("2026-07-25T10:00:00.000Z", true);
    expect(shouldAcceptServerSnapshot(accepted, outOfOrder, HYDRATED_AT_16_MIN).accept).toBe(false);
  });

  it("a legitimate newer reset IS applied", () => {
    const accepted = snapshotAt("2026-07-25T10:05:00.000Z", true);
    const reset = zeroSnapshotAt("2026-07-25T10:06:00.000Z");
    expect(shouldAcceptServerSnapshot(accepted, reset, HYDRATED_AT_16_MIN).accept).toBe(true);
  });

  it("a genuinely newer running snapshot (e.g. server clock ticked on) is applied", () => {
    const accepted = snapshotAt("2026-07-25T10:00:00.000Z", true);
    const newer = snapshotAt("2026-07-25T10:01:00.000Z", true);
    expect(shouldAcceptServerSnapshot(accepted, newer, HYDRATED_AT_16_MIN).accept).toBe(true);
  });

  it("half-time transition snapshot (running=false, half=2) is accepted when newer", () => {
    const accepted = snapshotAt("2026-07-25T10:05:00.000Z", true);
    const halfTime: ServerTimer = {
      ...snapshotAt("2026-07-25T10:24:00.000Z", false),
      current_half: 2,
      half_ended_at: "2026-07-25T10:24:00.000Z",
    };
    expect(shouldAcceptServerSnapshot(accepted, halfTime, HYDRATED_AT_16_MIN).accept).toBe(true);
  });

  it("idempotent re-read (same last_event_at, same flags) is accepted", () => {
    const accepted = snapshotAt("2026-07-25T10:05:00.000Z", true);
    const same = snapshotAt("2026-07-25T10:05:00.000Z", true);
    expect(shouldAcceptServerSnapshot(accepted, same, HYDRATED_AT_16_MIN).accept).toBe(true);
  });
});
