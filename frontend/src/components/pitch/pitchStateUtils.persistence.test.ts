import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isSoundEnabled,
  loadPitchState,
  loadTimerStateForMinutes,
  savePitchState,
} from "./pitchStateUtils";
import { PITCH_STATE_KEY, getPitchStateKey } from "./types";

const TEAM_TIMER_KEY = (teamId: string) => `pitch-board-timer-state-team-${teamId}`;
const ACTIVE_TIMER_KEY = "pitch-board-timer-state";

function pitchState(teamId: string, overrides: Record<string, unknown> = {}) {
  return {
    teamId,
    players: [{ id: "player-1", name: "Alex", position: null }],
    teamSize: 7,
    selectedFormation: 2,
    ballPosition: { x: 50, y: 50 },
    autoSubPlan: [],
    autoSubActive: false,
    autoSubPaused: false,
    mockMode: false,
    lastUpdateTime: Date.now(),
    linkedEventId: "event-1",
    goals: [],
    ...overrides,
  };
}

function timerState(teamId: string, overrides: Record<string, unknown> = {}) {
  return {
    teamId,
    minutesPerHalf: 20,
    currentHalf: 1,
    elapsedSeconds: 120,
    isRunning: false,
    soundEnabled: true,
    lastUpdateTime: Date.now(),
    ...overrides,
  };
}

describe("pitch state persistence boundaries", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
  });

  it("loads only the requested team's timer when another team is active", () => {
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(timerState("team-b")));
    localStorage.setItem(TEAM_TIMER_KEY("team-a"), JSON.stringify(timerState("team-a", { elapsedSeconds: 321 })));

    expect(loadTimerStateForMinutes("team-a")?.elapsedSeconds).toBe(321);
    expect(loadTimerStateForMinutes("team-c")).toBeNull();
  });

  it("uses the matching active timer as a migration fallback", () => {
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(timerState("team-a", { soundEnabled: false })));

    expect(loadTimerStateForMinutes("team-a")?.teamId).toBe("team-a");
    expect(isSoundEnabled("team-a")).toBe(false);
    expect(isSoundEnabled("missing-team")).toBe(true);
  });

  it("saves state under both the team-specific and discoverable active keys", () => {
    const changed = vi.fn();
    window.addEventListener("game-state-changed", changed);
    localStorage.setItem(TEAM_TIMER_KEY("team-a"), JSON.stringify(timerState("team-a", {
      currentHalf: 2,
      elapsedSeconds: 90,
    })));

    const state = pitchState("team-a");
    const { teamId: _teamId, lastUpdateTime: _lastUpdateTime, ...saveable } = state;
    savePitchState("team-a", saveable as any);

    const teamSaved = JSON.parse(localStorage.getItem(getPitchStateKey("team-a"))!);
    const activeSaved = JSON.parse(localStorage.getItem(PITCH_STATE_KEY)!);
    expect(teamSaved).toEqual(activeSaved);
    expect(teamSaved).toMatchObject({ teamId: "team-a", lastTimerSeconds: 1290 });
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener("game-state-changed", changed);
  });

  it("does not restore a different team's active pitch state", () => {
    localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(pitchState("team-b")));

    expect(loadPitchState("team-a")).toBeNull();
    expect(localStorage.getItem(getPitchStateKey("team-a"))).toBeNull();
  });

  it("migrates a matching legacy active pitch state to the team-specific key", () => {
    localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(pitchState("team-a")));

    expect(loadPitchState("team-a")?.linkedEventId).toBe("event-1");
    expect(JSON.parse(localStorage.getItem(getPitchStateKey("team-a"))!).teamId).toBe("team-a");
  });

  it("keeps the lineup, resets game progress, and clears stale timers after 12 hours", () => {
    const staleAt = Date.now() - 13 * 60 * 60 * 1000;
    localStorage.setItem(getPitchStateKey("team-a"), JSON.stringify(pitchState("team-a", { lastUpdateTime: staleAt })));
    localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(pitchState("team-a", { lastUpdateTime: staleAt })));
    localStorage.setItem(TEAM_TIMER_KEY("team-a"), JSON.stringify(timerState("team-a", { lastUpdateTime: staleAt })));
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(timerState("team-a", { lastUpdateTime: staleAt })));

    const loaded = loadPitchState("team-a")!;
    expect(loaded.players).toHaveLength(1);
    expect(loaded.linkedEventId).toBeNull();
    expect(loaded.goals).toEqual([]);
    expect(loaded.autoSubActive).toBe(false);
    expect(localStorage.getItem(getPitchStateKey("team-a"))).not.toBeNull();
    expect(localStorage.getItem(PITCH_STATE_KEY)).not.toBeNull();
    expect(localStorage.getItem(TEAM_TIMER_KEY("team-a"))).toBeNull();
    expect(localStorage.getItem(ACTIVE_TIMER_KEY)).toBeNull();
  });

  it("preserves old pitch state while a genuinely fresh timer is running", () => {
    const staleAt = Date.now() - 13 * 60 * 60 * 1000;
    localStorage.setItem(getPitchStateKey("team-a"), JSON.stringify(pitchState("team-a", { lastUpdateTime: staleAt })));
    localStorage.setItem(TEAM_TIMER_KEY("team-a"), JSON.stringify(timerState("team-a", {
      isRunning: true,
      lastUpdateTime: Date.now() - 1_000,
    })));

    expect(loadPitchState("team-a")?.teamId).toBe("team-a");
  });

  it("expires only the old autosub plan after two hours while retaining the game setup", () => {
    const staleAt = Date.now() - 3 * 60 * 60 * 1000;
    localStorage.setItem(getPitchStateKey("team-a"), JSON.stringify(pitchState("team-a", {
      lastUpdateTime: staleAt,
      autoSubActive: true,
      autoSubPaused: true,
      autoSubPlan: [{ half: 1, time: 300, executed: false }],
    })));

    const loaded = loadPitchState("team-a")!;
    expect(loaded.players).toHaveLength(1);
    expect(loaded.linkedEventId).toBe("event-1");
    expect(loaded.autoSubActive).toBe(false);
    expect(loaded.autoSubPaused).toBe(false);
    expect(loaded.autoSubPlan).toEqual([]);
  });

  it("fails closed on malformed local state rather than crashing the pitch board", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    localStorage.setItem(getPitchStateKey("team-a"), "not-json");

    expect(loadPitchState("team-a")).toBeNull();
  });
});
