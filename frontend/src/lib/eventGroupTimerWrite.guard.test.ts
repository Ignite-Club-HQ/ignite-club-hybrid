import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shouldWriteLocalTimerState, shouldApplyRemoteTimerState } from "@/lib/eventGroupTimerGuard";

/**
 * Event-group boards have no server-anchored timer, so `event_groups.timer_state`
 * is written straight from client localStorage on a 5s poll. Without a write-side
 * guard + CAS, a losing writer clobbers the shared row: the winner's own next read
 * rejects the regression, but a THIRD device joining in that window has no local
 * state and hydrates the clobbered clock.
 */
describe("shouldWriteLocalTimerState", () => {
  const running = (elapsedSeconds: number, extra: Record<string, unknown> = {}) => ({
    elapsedSeconds,
    currentHalf: 1,
    isRunning: true,
    lastUpdateTime: 1_000_000,
    ...extra,
  });

  it("allows the first real write over the `{}` column default", () => {
    expect(shouldWriteLocalTimerState({ local: running(30), remote: {} }).apply).toBe(true);
  });

  it("refuses to publish an empty local snapshot", () => {
    expect(shouldWriteLocalTimerState({ local: {}, remote: running(30) }).apply).toBe(false);
  });

  it("refuses to overwrite a peer's more advanced clock", () => {
    const d = shouldWriteLocalTimerState({
      local: running(100, { isRunning: false }),
      remote: running(400, { isRunning: false }),
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("would-regress-remote-clock");
  });

  it("allows a write when our clock is ahead", () => {
    expect(
      shouldWriteLocalTimerState({
        local: running(400, { isRunning: false }),
        remote: running(100, { isRunning: false }),
      }).apply,
    ).toBe(true);
  });

  it("refuses to overwrite a later half", () => {
    expect(
      shouldWriteLocalTimerState({
        local: running(200, { currentHalf: 1 }),
        remote: running(10, { currentHalf: 2 }),
      }).apply,
    ).toBe(false);
  });

  it("refuses to overwrite a finished game with an in-progress one", () => {
    expect(
      shouldWriteLocalTimerState({
        local: running(500),
        remote: running(600, { isGameFinished: true, isRunning: false }),
      }).apply,
    ).toBe(false);
  });

  it("does not resurrect a peer's pause from a stale running snapshot", () => {
    const d = shouldWriteLocalTimerState({
      local: running(300, { lastUpdateTime: 1_000 }),
      remote: running(300, { isRunning: false, lastUpdateTime: 5_000 }),
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("stale-local-resume");
  });

  it("tolerates sub-2s peer jitter in both directions (never deadlocks a board)", () => {
    const local = running(300, { isRunning: false });
    const remote = running(301, { isRunning: false });
    expect(shouldWriteLocalTimerState({ local, remote }).apply).toBe(true);
    expect(shouldWriteLocalTimerState({ local: remote, remote: local }).apply).toBe(true);
  });

  it("agrees with the read guard about which side is ahead", () => {
    // The two guards share a tolerance; for a clearly-behind local snapshot the
    // writer must withhold AND the reader must accept, or the pair oscillates.
    const behind = running(50, { isRunning: false });
    const ahead = running(600, { isRunning: false });
    expect(shouldWriteLocalTimerState({ local: behind, remote: ahead }).apply).toBe(false);
    expect(shouldApplyRemoteTimerState({ remote: ahead, local: behind, force: true }).apply).toBe(true);
  });
});

describe("useEventGroupSync write path", () => {
  const src = readFileSync("src/hooks/useEventGroupSync.ts", "utf8");

  it("gates every write behind readOnly", () => {
    // Spectators (BoardViewerDialog) mirror remote state into localStorage; if
    // they also write, a stale mirror is pushed back over the live coach clock.
    expect(src).toMatch(/if \(readOnly\) return;/);
  });

  it("scopes the update to the row version it read (CAS)", () => {
    expect(src).toContain('.eq("updated_at", current.updated_at)');
  });

  it("adopts peer state instead of retrying when CAS loses", () => {
    expect(src).toMatch(/updated\.length === 0[\s\S]{0,300}loadFromDatabase\(true\)/);
  });
});

describe("PitchBoard spectator wiring", () => {
  it("passes readOnly through to the event-group sync", () => {
    const src = readFileSync("src/components/pitch/PitchBoard.tsx", "utf8");
    expect(src).toMatch(/useEventGroupSync\(teamId, null, \{ readOnly \}\)/);
  });
});

describe("GlobalSubMonitor row lifecycle", () => {
  const src = readFileSync("src/components/pitch/GlobalSubMonitor.tsx", "utf8");

  it("has exactly one own-row deactivation, inside the guarded helper", () => {
    // Deactivating an anchored row makes pitch-timer-read return found:false and
    // the next resume re-anchors a fresh half from now() — a live clock reset.
    // All own-row deactivations must go through the guarded helper, so this
    // statement may appear once and only within `deactivateActiveGameRow`.
    const pattern = /update\(\{ is_active: false \}\)\s*\.eq\('id', activeGameIdRef\.current\)/g;
    expect(src.match(pattern)).toHaveLength(1);

    const helper = src.slice(src.indexOf("const deactivateActiveGameRow = async"));
    const helperBody = helper.slice(0, helper.indexOf("\n    };"));
    expect(helperBody).toMatch(pattern);
  });


  it("routes deactivation through the anchored-row guard", () => {
    expect(src).toMatch(/const deactivateActiveGameRow = async/);
    expect(src).toMatch(/if \(isServerAnchoredTimer\) \{[\s\S]{0,200}return;/);
  });

  it("does not synthesise a fresh anchor when no row is owned by this user", () => {
    expect(src).toMatch(/deferring to pitch-timer-event/);
  });
});
