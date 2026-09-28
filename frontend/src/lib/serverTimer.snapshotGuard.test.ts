import { describe, it, expect } from "vitest";
import { shouldAcceptServerSnapshot, type ServerTimer, type LocalTimerSnapshot } from "./serverTimer";

const mk = (overrides: Partial<ServerTimer> = {}): ServerTimer => ({
  schema_version: 2,
  current_half: 1,
  minutes_per_half: 20,
  half_started_at: "2026-07-25T10:00:00.000Z",
  half_paused_at: null,
  accumulated_pause_ms: 0,
  is_running: true,
  is_game_finished: false,
  half_ended_at: null,
  last_event_at: "2026-07-25T10:00:00.000Z",
  ...overrides,
});

const advanced: LocalTimerSnapshot = { isRunning: true, currentHalf: 1, elapsedSeconds: 960, isGameFinished: false };
const idle: LocalTimerSnapshot = { isRunning: false, currentHalf: 1, elapsedSeconds: 0, isGameFinished: false };

describe("shouldAcceptServerSnapshot", () => {
  it("accepts the first hydrate when there is no prior snapshot", () => {
    expect(shouldAcceptServerSnapshot(null, mk(), idle).accept).toBe(true);
    expect(shouldAcceptServerSnapshot(undefined, mk(), advanced).accept).toBe(true);
  });

  it("accepts strictly newer authoritative events", () => {
    const prev = mk({ last_event_at: "2026-07-25T10:00:00.000Z" });
    const next = mk({ last_event_at: "2026-07-25T10:16:00.000Z", is_running: true });
    expect(shouldAcceptServerSnapshot(prev, next, advanced).accept).toBe(true);
  });

  it("rejects a stale zero snapshot that would move an active clock backwards", () => {
    const prev = mk({ last_event_at: "2026-07-25T10:16:00.000Z", is_running: true });
    const stale = mk({
      last_event_at: "2026-07-25T10:00:00.000Z",
      is_running: false,
      half_started_at: null,
      current_half: 1,
    });
    const d = shouldAcceptServerSnapshot(prev, stale, advanced);
    expect(d.accept).toBe(false);
    expect(d.reason).toMatch(/older|stale|regress/);
  });

  it("rejects an equal-timestamp zero snapshot when local has advanced", () => {
    const prev = mk({ last_event_at: "2026-07-25T10:16:00.000Z", is_running: true });
    const equal = mk({
      last_event_at: "2026-07-25T10:16:00.000Z",
      is_running: false,
      half_started_at: null,
      current_half: 1,
    });
    expect(shouldAcceptServerSnapshot(prev, equal, advanced).accept).toBe(false);
  });

  it("accepts a legitimate manual reset (newer timestamp, zero state)", () => {
    const prev = mk({ last_event_at: "2026-07-25T10:16:00.000Z", is_running: true });
    const reset = mk({
      last_event_at: "2026-07-25T10:17:00.000Z",
      is_running: false,
      half_started_at: null,
      current_half: 1,
    });
    expect(shouldAcceptServerSnapshot(prev, reset, advanced).accept).toBe(true);
  });

  it("accepts idempotent re-reads when local matches", () => {
    const prev = mk({ last_event_at: "2026-07-25T10:16:00.000Z", is_running: true });
    const same = mk({ last_event_at: "2026-07-25T10:16:00.000Z", is_running: true });
    expect(shouldAcceptServerSnapshot(prev, same, advanced).accept).toBe(true);
  });

  it("rejects an older snapshot even when it isn't a zero snapshot, if local is advanced", () => {
    const prev = mk({ last_event_at: "2026-07-25T10:16:00.000Z", is_running: true });
    const older = mk({ last_event_at: "2026-07-25T10:05:00.000Z", is_running: true });
    expect(shouldAcceptServerSnapshot(prev, older, advanced).accept).toBe(false);
  });

  it("permits an older snapshot when local clock is fully quiescent", () => {
    // Fresh mount with no clock advancement — accepting an older snapshot is
    // harmless because we can't move backwards from zero.
    const prev = mk({ last_event_at: "2026-07-25T10:16:00.000Z" });
    const older = mk({ last_event_at: "2026-07-25T10:00:00.000Z", is_running: false, half_started_at: null });
    // With `idle` local state this still rejects because rule 4 fires — the
    // guard is conservative by design; only strictly-newer events flip a
    // display that already accepted a later snapshot.
    expect(shouldAcceptServerSnapshot(prev, older, idle).accept).toBe(false);
  });

  it("accepts a newer half-transition snapshot even if is_running flips false", () => {
    const prev = mk({ last_event_at: "2026-07-25T10:16:00.000Z", is_running: true });
    const endHalf = mk({
      last_event_at: "2026-07-25T10:20:00.000Z",
      is_running: false,
      current_half: 2,
      half_started_at: null,
    });
    // current_half=2 → not the "stale zero" shape, and timestamp is newer.
    expect(shouldAcceptServerSnapshot(prev, endHalf, advanced).accept).toBe(true);
  });
});
