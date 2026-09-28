import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, SubstitutionEvent } from "../types";

const mocks = vi.hoisted(() => ({ remote: [] as Player[], recalculate: vi.fn() }));
vi.mock("@/hooks/useRemoteFillInSync", () => ({ useRemoteFillInSync: () => mocks.remote }));
vi.mock("../pitchStateUtils", async (original) => ({
  ...(await original<typeof import("../pitchStateUtils")>()),
  recalculateRemainingPlanTeamAware: (...args: unknown[]) => mocks.recalculate(...args),
}));

import { usePitchBoardFillIn } from "./usePitchBoardFillIn";

const basePlayers: Player[] = [
  { id: "pitch", name: "Starter", number: 4, position: { x: 50, y: 50 }, currentPitchPosition: "MID" },
  { id: "bench", name: "Reserve", number: 8, position: null, assignedPositions: ["MID"] },
];
const plannedSub: SubstitutionEvent = {
  time: 300, half: 1, playerOut: basePlayers[0], playerIn: basePlayers[1], executed: false,
};

function setup(overrides: Record<string, unknown> = {}) {
  let currentPlayers = basePlayers.map((p) => ({ ...p }));
  let currentPlan = [plannedSub];
  const setPlayers = vi.fn((update: React.SetStateAction<Player[]>) => {
    currentPlayers = typeof update === "function" ? update(currentPlayers) : update;
  });
  const setAutoSubPlan = vi.fn((update: React.SetStateAction<SubstitutionEvent[]>) => {
    currentPlan = typeof update === "function" ? update(currentPlan) : update;
  });
  const args = {
    readOnly: false, teamId: "team-1", players: currentPlayers, setPlayers,
    autoSubPlan: currentPlan, setAutoSubPlan, autoSubActive: true,
    handleCancelAutoSubPlan: vi.fn(), teamSize: "7" as const, rotateGkAtHalftime: true,
    gameTimerRef: { current: { getMinutesPerHalf: () => 20, getElapsedSeconds: () => 240, getCurrentHalf: () => 1 as const } },
    toast: vi.fn(), ...overrides,
  };
  const hook = renderHook(() => usePitchBoardFillIn(args));
  return { args, getPlayers: () => currentPlayers, getPlan: () => currentPlan, ...hook };
}

describe("pitchboard fill-in lifecycle", () => {
  beforeEach(() => { mocks.remote = []; mocks.recalculate.mockReset(); });

  it("adds a synthetic fill-in to the bench with positions and a collision-free identity", () => {
    vi.spyOn(Date, "now").mockReturnValue(12345);
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    const { result, getPlayers } = setup({ autoSubPlan: [] });
    act(() => result.current.handleAddFillInPlayer({ name: "Guest Player", number: 19, positions: ["FWD"] }));
    const added = getPlayers().find((p) => p.name === "Guest Player");
    expect(added).toMatchObject({ number: 19, assignedPositions: ["FWD"], position: null, isFillIn: true, minutesPlayed: 0 });
    expect(added?.id).toMatch(/^fill-in-12345-/);
  });

  it("repairs only the remaining autosub tail after adding a fill-in", () => {
    const repaired = [{ ...plannedSub, time: 420 }];
    mocks.recalculate.mockReturnValue(repaired);
    const { result, args } = setup();
    act(() => result.current.handleAddFillInPlayer({ name: "Late Guest", positions: ["MID"] }));
    expect(mocks.recalculate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "Late Guest", isFillIn: true })]),
      7, 1200, 240, 1, plannedSub, true,
    );
    expect(args.setAutoSubPlan).toHaveBeenCalledWith(repaired);
    expect(args.handleCancelAutoSubPlan).not.toHaveBeenCalled();
  });

  it("keeps the existing remaining plan if recalculation cannot safely improve it", () => {
    mocks.recalculate.mockReturnValue([]);
    const { result, getPlan } = setup();
    act(() => result.current.handleAddFillInPlayer({ name: "Late Guest", positions: ["DEF"] }));
    expect(getPlan()).toEqual([plannedSub]);
  });

  it("refuses to remove an on-pitch fill-in", () => {
    const fill: Player = { id: "fill", name: "Guest", isFillIn: true, position: { x: 10, y: 20 } };
    const { result, args, getPlayers } = setup({ players: [...basePlayers, fill] });
    // setup owns its initial state, so exercise a dedicated hook with the explicit roster.
    const local = renderHook(() => usePitchBoardFillIn({ ...args, players: [...basePlayers, fill] }));
    act(() => local.result.current.handleRemoveFillInPlayer("fill"));
    expect(args.setPlayers).not.toHaveBeenCalled();
    expect(args.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Cannot remove", variant: "destructive" }));
    expect(getPlayers()).toHaveLength(2);
  });

  it("removing a planned bench fill-in cancels unsafe active autosubs", () => {
    const fill: Player = { id: "fill", name: "Guest", isFillIn: true, position: null };
    const fillPlan = [{ ...plannedSub, playerIn: fill }];
    const cancel = vi.fn();
    let roster = [...basePlayers, fill];
    const setPlayers = vi.fn((update: React.SetStateAction<Player[]>) => { roster = typeof update === "function" ? update(roster) : update; });
    const { result } = renderHook(() => usePitchBoardFillIn({
      readOnly: false, teamId: "team-1", players: roster, setPlayers,
      autoSubPlan: fillPlan, setAutoSubPlan: vi.fn(), autoSubActive: true,
      handleCancelAutoSubPlan: cancel, teamSize: "7", rotateGkAtHalftime: true,
      gameTimerRef: { current: null }, toast: vi.fn(),
    }));
    act(() => result.current.handleRemoveFillInPlayer("fill"));
    expect(roster.some((p) => p.id === "fill")).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("read-only boards cannot add or remove fill-ins", () => {
    const { result, args } = setup({ readOnly: true });
    act(() => result.current.handleAddFillInPlayer({ name: "Blocked", positions: [] }));
    act(() => result.current.handleRemoveFillInPlayer("bench"));
    expect(args.setPlayers).not.toHaveBeenCalled();
  });

  it("merges remote fill-ins once, normalized to the bench, without duplicating roster players", () => {
    mocks.remote = [
      { id: "bench", name: "Duplicate", isFillIn: true, position: { x: 1, y: 1 } },
      { id: "remote-fill", name: "Remote Guest", isFillIn: true, position: { x: 2, y: 2 }, currentPitchPosition: "FWD" },
    ];
    const { getPlayers } = setup({ autoSubPlan: [] });
    expect(getPlayers().filter((p) => p.id === "bench")).toHaveLength(1);
    expect(getPlayers().find((p) => p.id === "remote-fill")).toMatchObject({ position: null, currentPitchPosition: undefined, isFillIn: true });
  });

  it("reports every occupied jersey number to prevent fill-in collisions", () => {
    const { result } = setup({ autoSubPlan: [] });
    expect(result.current.existingJerseyNumbers).toEqual([4, 8]);
  });
});
