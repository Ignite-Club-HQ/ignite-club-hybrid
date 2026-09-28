import { describe, it, expect } from "vitest";
import { shouldAdoptRemoteLineup, buildEventLineupSnapshot } from "./eventLineupRepository";
import type { PitchBoardState } from "./types";

const remote = { snapshot: {} as never, updatedAt: 5_000 };

const localFor = (over: Partial<PitchBoardState>): PitchBoardState => ({
  teamId: "t1",
  players: [{ id: "p1", name: "A", number: 1, position: { x: 1, y: 2 }, minutesPlayed: 0 } as never],
  teamSize: "7",
  selectedFormation: 0,
  ballPosition: { x: 50, y: 50 },
  autoSubPlan: [],
  autoSubActive: false,
  autoSubPaused: false,
  mockMode: false,
  lastUpdateTime: 1_000,
  linkedEventId: "e1",
  ...over,
});

describe("shouldAdoptRemoteLineup", () => {
  it("adopts when there is no local state", () => {
    expect(shouldAdoptRemoteLineup({ remote, local: null, eventId: "e1", timerRunning: false })).toBe(true);
  });

  it("never disturbs a live game", () => {
    expect(shouldAdoptRemoteLineup({ remote, local: null, eventId: "e1", timerRunning: true })).toBe(false);
  });

  it("adopts when local state belongs to another fixture", () => {
    expect(
      shouldAdoptRemoteLineup({ remote, local: localFor({ linkedEventId: "other" }), eventId: "e1", timerRunning: false })
    ).toBe(true);
  });

  it("keeps newer local state for the same fixture", () => {
    expect(
      shouldAdoptRemoteLineup({ remote, local: localFor({ lastUpdateTime: 9_000 }), eventId: "e1", timerRunning: false })
    ).toBe(false);
  });

  it("adopts newer remote state for the same fixture", () => {
    expect(
      shouldAdoptRemoteLineup({ remote, local: localFor({ lastUpdateTime: 100 }), eventId: "e1", timerRunning: false })
    ).toBe(true);
  });

  it("does nothing when there is no remote lineup", () => {
    expect(shouldAdoptRemoteLineup({ remote: null, local: null, eventId: "e1", timerRunning: false })).toBe(false);
  });
});

describe("buildEventLineupSnapshot", () => {
  it("keeps fill-ins but strips live progress", () => {
    const snap = buildEventLineupSnapshot({
      players: [
        { id: "p1", name: "A", number: 1, position: { x: 1, y: 2 }, minutesPlayed: 34, isInjured: true } as never,
        { id: "f1", name: "Guest", number: 9, position: null, minutesPlayed: 12, isFillIn: true } as never,
      ],
      teamSize: "7",
      selectedFormation: 1,
    });
    // Fill-ins belong to this fixture (snapshot is keyed by event_id) and must
    // persist to game day; only live progress is stripped.
    expect(snap.players).toHaveLength(2);
    expect(snap.players[0].minutesPlayed).toBe(0);
    expect(snap.players[0].isInjured).toBe(false);
    const guest = snap.players.find((p) => p.id === "f1");
    expect(guest?.isFillIn).toBe(true);
    expect(guest?.minutesPlayed).toBe(0);
  });
});
