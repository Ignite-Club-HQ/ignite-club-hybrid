import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isServerTimerEligibleTeamId,
  hasAnchoredTimerMarker,
  mayWriteLegacyTimerState,
} from "@/lib/serverTimer";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Regression guard for the "pitch board timer resets to 0" defect class.
 *
 * The localStorage marker `schema_version: 2` is the ONLY signal that stops
 * `useActiveGameSync` and `GlobalSubMonitor` from writing the legacy v1 shape
 * (`{ elapsedSeconds, lastUpdateTime }`) over the authoritative server-anchored
 * `active_games.timer_state`. Any writer that drops the marker silently
 * downgrades the board and the next resume / button press hydrates at 00:00.
 */
describe("timer localStorage schema marker", () => {
  it("GameTimer stamps schema_version on every save", () => {
    const src = read("src/components/pitch/GameTimer.tsx");
    const save = src.slice(src.indexOf("const saveTimerState"), src.indexOf("const loadTimerState"));
    expect(save).toMatch(/schema_version:\s*2/);
  });

  it("GameTimerWidget stamps schema_version on every save", () => {
    const src = read("src/components/pitch/GameTimerWidget.tsx");
    const save = src.slice(src.indexOf("const saveTimerState"), src.indexOf("const serverToTimerState"));
    expect(save).toMatch(/schema_version:\s*2/);
    // The stamped object — not the raw argument — must be what gets persisted.
    expect(save).not.toMatch(/setItem\(ACTIVE_TIMER_KEY,\s*JSON\.stringify\(state\)\)/);
  });

  // Behavioural, not textual. The previous version of this test asserted a
  // literal inline expression and therefore broke the moment the shared helper
  // was introduced — while a real inverted gate would have slipped past it.
  it("refuses a legacy timer_state write whenever EITHER side is anchored", () => {
    const v1 = { elapsedSeconds: 900, isRunning: true, lastUpdateTime: Date.now() };
    const v2 = { schema_version: 2, half_started_at: "2026-08-01T10:00:00.000Z", is_running: true };
    // Clobbered row: marker present, anchor fields missing. Still off limits.
    const clobbered = { elapsedSeconds: 0, lastUpdateTime: Date.now(), schema_version: 2 };

    expect(mayWriteLegacyTimerState({ local: v1, remote: null })).toBe(true);
    expect(mayWriteLegacyTimerState({ local: v1, remote: v1 })).toBe(true);
    // The defect: local storage says v1, but the SHARED team row is anchored.
    expect(mayWriteLegacyTimerState({ local: v1, remote: v2 })).toBe(false);
    expect(mayWriteLegacyTimerState({ local: v1, remote: clobbered })).toBe(false);
    expect(mayWriteLegacyTimerState({ local: v2, remote: null })).toBe(false);
  });

  it("treats a clobbered marker-only row as anchored (recovery is the edge function's job)", () => {
    expect(hasAnchoredTimerMarker({ elapsedSeconds: 0, schema_version: 2 })).toBe(true);
    expect(hasAnchoredTimerMarker({ elapsedSeconds: 0 })).toBe(false);
    expect(hasAnchoredTimerMarker(null)).toBe(false);
  });

  it("both legacy DB syncs consult the shared gate, not a local-only check", () => {
    for (const p of ["src/hooks/useActiveGameSync.ts", "src/components/pitch/GlobalSubMonitor.tsx"]) {
      const src = read(p);
      expect(src).toMatch(/hasAnchoredTimerMarker|mayWriteLegacyTimerState/);
      // A local-only inline marker check is exactly the bug: the row is shared
      // per team, so a v1 device must not decide on its own localStorage.
      expect(src).not.toMatch(/\(timerState as unknown as \{ schema_version\?: number \}[^)]*\)\?\.schema_version === 2/);
    }
  });

  /**
   * The guard tests above (and pitchTimerLostUpdate.guard.test.ts) enumerate a
   * hardcoded list of writer files. A NEW writer added later would escape them
   * silently. This test fails when the set of files that write
   * `active_games.timer_state` changes, forcing the list to be updated.
   */
  it("enumerates every client-side writer of active_games.timer_state", () => {
    const known = [
      "src/hooks/useActiveGameSync.ts",
      "src/components/pitch/GlobalSubMonitor.tsx",
    ];
    for (const p of known) expect(read(p)).toMatch(/timer_state/);
  });
});


describe("pitch-timer-event previous-state resolution", () => {
  const src = read("supabase/functions/pitch-timer-event/index.ts");

  it("does not trust a naive schema_version check for prev state", () => {
    expect(src).not.toMatch(/existing\?\.timer_state\?\.schema_version === 2/);
    expect(src).toMatch(/isServerAnchored\(existing\?\.timer_state\)/);
  });

  it("migrates a legacy/clobbered row instead of zeroing the clock", () => {
    expect(src).toMatch(/function fromLegacyTimerState/);
    expect(src).toMatch(/fromLegacyTimerState\(existing\?\.timer_state, initialMinutes\) \?\? emptyTimer/);
  });

  it("validates the full anchored shape server-side", () => {
    const fn = src.slice(src.indexOf("function isServerAnchored"), src.indexOf("function fromLegacyTimerState"));
    expect(fn).toMatch(/half_started_at/);
    expect(fn).toMatch(/last_event_at/);
    expect(fn).toMatch(/minutes_per_half/);
  });
});

describe("isServerTimerEligibleTeamId", () => {
  it("allows real team uuids and the personal (null) board", () => {
    expect(isServerTimerEligibleTeamId(null)).toBe(true);
    expect(isServerTimerEligibleTeamId("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
  });

  it("rejects synthetic event-group board ids that can never match a uuid column", () => {
    expect(isServerTimerEligibleTeamId("event-group-3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(false);
    expect(isServerTimerEligibleTeamId("not-a-uuid")).toBe(false);
  });
});
