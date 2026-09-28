import { describe, it, expect, beforeEach } from "vitest";
import { loadPitchState, savePitchState } from "./pitchStateUtils";
import type { Player } from "./types";

const teamId = "team-1";

const player = (id: string, onPitch: boolean, fillIn = false): Player => ({
  id,
  name: `Player ${id}`,
  position: onPitch ? { x: 50, y: 80 } : null,
  currentPitchPosition: onPitch ? "DEF" : undefined,
  minutesPlayed: onPitch ? 900 : 0,
  isFillIn: fillIn,
});

describe("pitch state lineup persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const seedStaleState = () => {
    savePitchState(teamId, {
      players: [player("a", true), player("b", false), player("guest", true, true)],
      teamSize: "9",
      selectedFormation: 2,
      ballPosition: { x: 50, y: 50 },
      autoSubPlan: [],
      autoSubActive: true,
      autoSubPaused: false,
      mockMode: false,
      linkedEventId: "event-yesterday",
      goals: [{ playerId: "a", playerName: "Player a", minute: 12, half: 1, at: Date.now() }],
    } as never);

    // Age the saved state beyond the 12h freshness window.
    const key = `ignite-pitch-board-state-team-${teamId}`;
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.lastUpdateTime = Date.now() - 48 * 60 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify(saved));
  };

  it("keeps the planned lineup after more than 12 hours", () => {
    seedStaleState();
    const loaded = loadPitchState(teamId);
    expect(loaded).not.toBeNull();
    expect(loaded!.teamSize).toBe("9");
    expect(loaded!.selectedFormation).toBe(2);
    const a = loaded!.players.find((p) => p.id === "a");
    expect(a?.position).toEqual({ x: 50, y: 80 });
  });

  it("resets game progress but keeps fill-ins when stale", () => {
    seedStaleState();
    const loaded = loadPitchState(teamId)!;
    // Fill-ins belong to the fixture the coach planned — they must survive to
    // game day. Cross-fixture leakage is handled by PitchBoard's
    // savedStateIsForDifferentEvent purge, not here.
    const guest = loaded.players.find((p) => p.id === "guest");
    expect(guest?.isFillIn).toBe(true);
    expect(loaded.players.every((p) => (p.minutesPlayed ?? 0) === 0)).toBe(true);
    expect(loaded.goals).toEqual([]);
    expect(loaded.autoSubActive).toBe(false);
    expect(loaded.autoSubPlan).toEqual([]);
    expect(loaded.linkedEventId).toBeNull();
  });

  it("persists the reset lineup so a later load stays stable", () => {
    seedStaleState();
    loadPitchState(teamId);
    const second = loadPitchState(teamId)!;
    expect(second.players.find((p) => p.id === "a")?.position).toEqual({ x: 50, y: 80 });
  });
});
