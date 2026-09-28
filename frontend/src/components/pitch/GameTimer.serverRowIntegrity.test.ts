/**
 * Guards the "pitch timer resets to 0 after the app goes inactive" defect.
 *
 * Root cause: legacy 10s sync paths (useActiveGameSync / GlobalSubMonitor)
 * wrote the v1 localStorage shape over the authoritative server-anchored row.
 * The result still carried `schema_version: 2` but had no `half_started_at`,
 * so `pitch-timer-read` derived elapsed = 0 and the client hydrated at 00:00.
 */
import { describe, it, expect } from "vitest";
import {
  isServerAnchoredTimer,
  shouldPreferLocalOnFirstHydrate,
  type ServerTimer,
} from "@/lib/serverTimer";

const running = (opts: Partial<ServerTimer> = {}): ServerTimer => ({
  schema_version: 2,
  current_half: 1,
  minutes_per_half: 40,
  half_started_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
  half_paused_at: null,
  accumulated_pause_ms: 0,
  is_running: true,
  is_game_finished: false,
  half_ended_at: null,
  last_event_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
  ...opts,
});

describe("server timer row integrity", () => {
  it("rejects a clobbered v1-over-v2 row (no half_started_at / last_event_at)", () => {
    expect(
      isServerAnchoredTimer({ schema_version: 2, elapsedSeconds: 960, lastUpdateTime: Date.now() }),
    ).toBe(false);
  });

  it("rejects legacy v1 and empty rows", () => {
    expect(isServerAnchoredTimer({})).toBe(false);
    expect(isServerAnchoredTimer(null)).toBe(false);
    expect(isServerAnchoredTimer({ schema_version: 1 })).toBe(false);
  });

  it("accepts a well-formed server-anchored row", () => {
    expect(isServerAnchoredTimer(running())).toBe(true);
  });

  it("keeps the local clock when a stale zeroed row would rewind it", () => {
    const zeroed = running({
      half_started_at: null,
      is_running: false,
      last_event_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    expect(
      shouldPreferLocalOnFirstHydrate({
        incoming: zeroed,
        serverNowMs: Date.now(),
        localElapsedSeconds: 16 * 60,
        localCurrentHalf: 1,
        localIsRunning: true,
        localLastUpdateMs: Date.now() - 1000,
      }),
    ).toBe(true);
  });

  it("defers to the server when the server has the newer event", () => {
    const newer = running({ last_event_at: new Date(Date.now() - 500).toISOString() });
    expect(
      shouldPreferLocalOnFirstHydrate({
        incoming: newer,
        serverNowMs: Date.now(),
        localElapsedSeconds: 16 * 60,
        localCurrentHalf: 1,
        localIsRunning: true,
        localLastUpdateMs: Date.now() - 60_000,
      }),
    ).toBe(false);
  });

  it("does not prefer local when there is no local progress", () => {
    expect(
      shouldPreferLocalOnFirstHydrate({
        incoming: running(),
        serverNowMs: Date.now(),
        localElapsedSeconds: 0,
        localCurrentHalf: 1,
        localIsRunning: false,
        localLastUpdateMs: Date.now(),
      }),
    ).toBe(false);
  });
});
