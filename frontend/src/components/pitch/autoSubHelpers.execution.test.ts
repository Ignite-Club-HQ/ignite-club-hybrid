import { describe, expect, it } from "vitest";
import {
  executeSubsOnPlayers,
  getSubKey,
  markSubsExecuted,
} from "./autoSubHelpers";
import type { PitchPosition } from "./PositionBadge";
import type { Player, SubstitutionEvent } from "./types";

const player = (
  id: string,
  pitchPosition: PitchPosition | null,
  overrides: Partial<Player> = {},
): Player => ({
  id,
  name: id,
  position: pitchPosition ? { x: id.charCodeAt(0), y: 50 } : null,
  currentPitchPosition: pitchPosition ?? undefined,
  assignedPositions: pitchPosition ? [pitchPosition] : ["DEF", "MID", "FWD"],
  minutesPlayed: 0,
  ...overrides,
} as Player);

const substitution = (
  playerOut: Player,
  playerIn: Player,
  overrides: Partial<SubstitutionEvent> = {},
): SubstitutionEvent => ({
  half: 1,
  time: 5 * 60,
  playerOut,
  playerIn,
  ...overrides,
});

const byId = (players: Player[], id: string) =>
  players.find((candidate) => candidate.id === id)!;

describe("executeSubsOnPlayers state transitions", () => {
  it("moves the outgoing player to the bench and incoming player into the exact vacated slot", () => {
    const outgoing = player("A", "MID");
    const incoming = player("B", null);
    const untouched = player("C", "DEF");
    const originalSlot = outgoing.position;
    const result = executeSubsOnPlayers(
      [substitution(outgoing, incoming)],
      [outgoing, incoming, untouched],
    );

    expect(result.successCount).toBe(1);
    expect(result.skippedSubKeys).toEqual([]);
    expect(byId(result.updatedPlayers, "A")).toMatchObject({
      position: null,
      currentPitchPosition: undefined,
    });
    expect(byId(result.updatedPlayers, "B")).toMatchObject({
      position: originalSlot,
      currentPitchPosition: "MID",
    });
    expect(byId(result.updatedPlayers, "C")).toEqual(untouched);
  });

  it("applies a three-player position swap without losing or duplicating pitch slots", () => {
    const outgoing = player("A", "DEF");
    const swapPlayer = player("C", "MID");
    const incoming = player("B", null, { assignedPositions: ["MID"] });
    const outgoingSlot = outgoing.position;
    const swapSlot = swapPlayer.position;
    const sub = substitution(outgoing, incoming, {
      positionSwap: {
        player: swapPlayer,
        fromPosition: "MID",
        toPosition: "DEF",
      },
    });

    const result = executeSubsOnPlayers(
      [sub],
      [outgoing, incoming, swapPlayer],
    );

    expect(result.successCount).toBe(1);
    expect(byId(result.updatedPlayers, "A").position).toBeNull();
    expect(byId(result.updatedPlayers, "C")).toMatchObject({
      position: outgoingSlot,
      currentPitchPosition: "DEF",
    });
    expect(byId(result.updatedPlayers, "B")).toMatchObject({
      position: swapSlot,
      currentPitchPosition: "MID",
    });
    expect(
      result.updatedPlayers.filter((candidate) => candidate.position !== null),
    ).toHaveLength(2);
  });

  it("is safe to retry: an already-applied substitution is skipped without changing the lineup", () => {
    const outgoing = player("A", "MID");
    const incoming = player("B", null);
    const reserve = player("C", null);
    const sub = substitution(outgoing, incoming);
    const first = executeSubsOnPlayers([sub], [outgoing, incoming, reserve]);
    const retry = executeSubsOnPlayers([sub], first.updatedPlayers);

    expect(retry.successCount).toBe(0);
    expect(retry.executedSubKeys).toEqual([]);
    expect(retry.skippedSubKeys).toEqual([getSubKey(sub)]);
    expect(retry.updatedPlayers).toEqual(first.updatedPlayers);
  });

  it("uses a healthy outfield reserve when the planned incoming player is unavailable", () => {
    const outgoing = player("A", "MID");
    const plannedIncoming = player("B", "DEF"); // already on the pitch
    const injured = player("C", null, { isInjured: true });
    const gkOnly = player("D", null, { assignedPositions: ["GK"] });
    const reserve = player("E", null, { assignedPositions: ["MID"] });
    const sub = substitution(outgoing, plannedIncoming);

    const result = executeSubsOnPlayers(
      [sub],
      [outgoing, plannedIncoming, injured, gkOnly, reserve],
    );

    expect(result.successCount).toBe(1);
    expect(byId(result.updatedPlayers, "A").position).toBeNull();
    expect(byId(result.updatedPlayers, "E")).toMatchObject({
      position: outgoing.position,
      currentPitchPosition: "MID",
    });
    expect(byId(result.updatedPlayers, "C").position).toBeNull();
    expect(byId(result.updatedPlayers, "D").position).toBeNull();
  });

  it("skips an invalid substitution when no safe replacement exists", () => {
    const outgoing = player("A", "MID");
    const unavailableIncoming = player("B", "DEF");
    const injured = player("C", null, { isInjured: true });
    const gkOnly = player("D", null, { assignedPositions: ["GK"] });
    const original = [outgoing, unavailableIncoming, injured, gkOnly];
    const sub = substitution(outgoing, unavailableIncoming);

    const result = executeSubsOnPlayers([sub], original);

    expect(result.successCount).toBe(0);
    expect(result.executedSubKeys).toEqual([]);
    expect(result.skippedSubKeys).toEqual([getSubKey(sub)]);
    expect(result.updatedPlayers).toEqual(original);
  });

  it("marks only confirmed plan entries and preserves skipped history", () => {
    const a = player("A", "MID");
    const b = player("B", null);
    const c = player("C", "DEF");
    const d = player("D", null);
    const first = substitution(a, b);
    const second = substitution(c, d, { time: 10 * 60 });
    const alreadySkipped = { ...first, time: 2 * 60, executed: true, skipped: true };

    const updated = markSubsExecuted(
      [alreadySkipped, first, second],
      [getSubKey(second)],
    );

    expect(updated[0]).toMatchObject({ executed: true, skipped: true });
    expect(updated[1].executed).toBeUndefined();
    expect(updated[2]).toMatchObject({ executed: true });
    expect(updated[2].skipped).toBeUndefined();
  });
});
