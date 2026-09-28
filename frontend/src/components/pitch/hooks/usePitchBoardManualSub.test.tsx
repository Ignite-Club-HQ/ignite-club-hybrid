import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePitchBoardManualSub, type ManualSubDeps } from "./usePitchBoardManualSub";
import type { Player } from "../types";

const initialPlayers: Player[] = [
  { id: "out", name: "Outgoing", position: { x: 30, y: 40 }, currentPitchPosition: "MID", minutesPlayed: 20 },
  { id: "in", name: "Incoming", position: null, assignedPositions: ["MID"], minutesPlayed: 5 },
  { id: "swap", name: "Swap", position: { x: 70, y: 25 }, currentPitchPosition: "FWD", minutesPlayed: 20 },
];

function setup(players = initialPlayers) {
  let current = players.map((player) => ({ ...player }));
  const setPlayers = vi.fn((update: React.SetStateAction<Player[]>) => {
    current = typeof update === "function" ? update(current) : update;
    deps.playersRef.current = current;
  });
  const deps: ManualSubDeps = {
    isUndoingRef: { current: false }, playersRef: { current }, subMode: true,
    selectedOnPitch: null, selectedOnBench: null, players: current, benchToSubPlayer: "in",
    setPlayers, setSelectedOnPitch: vi.fn(), setSelectedOnBench: vi.fn(), setSubMode: vi.fn(),
    setPendingSubBenchPlayer: vi.fn(), setRequiredPosition: vi.fn(), setPositionSwapDialogOpen: vi.fn(),
    setBenchToSubOpen: vi.fn(), runSubAnimation: vi.fn(), pushToUndoHistory: vi.fn(), toast: vi.fn(),
  };
  const hook = renderHook(() => {
    const value = usePitchBoardManualSub();
    value.manualSubDepsRef.current = deps;
    return value;
  });
  return { deps, getPlayers: () => current, ...hook };
}

describe("pitchboard manual substitutions", () => {
  it("moves a compatible bench player into the exact vacated slot and records undo", () => {
    const { result, deps, getPlayers } = setup();
    act(() => result.current.setPendingManualSub({ pitchPlayerId: "out", benchPlayerId: "in" }));
    act(() => result.current.handleConfirmManualSub());
    expect(getPlayers().find((p) => p.id === "out")?.position).toBeNull();
    expect(getPlayers().find((p) => p.id === "in")).toMatchObject({ position: { x: 30, y: 40 }, currentPitchPosition: "MID" });
    expect(deps.pushToUndoHistory).toHaveBeenCalledTimes(1);
    expect(deps.runSubAnimation).toHaveBeenCalledWith("out", "in");
    expect(deps.setSubMode).toHaveBeenCalledWith(false);
  });

  it("executes a legal three-player position swap without duplicating a pitch slot", () => {
    const { result, deps, getPlayers } = setup();
    act(() => result.current.setPendingManualSub({ pitchPlayerId: "out", benchPlayerId: "in", swapPlayerId: "swap" }));
    act(() => result.current.handleConfirmManualSub());
    expect(getPlayers().find((p) => p.id === "out")?.position).toBeNull();
    expect(getPlayers().find((p) => p.id === "swap")).toMatchObject({ position: { x: 30, y: 40 }, currentPitchPosition: "MID" });
    expect(getPlayers().find((p) => p.id === "in")).toMatchObject({ position: { x: 70, y: 25 }, currentPitchPosition: "FWD" });
    expect(getPlayers().filter((p) => p.position).map((p) => `${p.position!.x}:${p.position!.y}`)).toHaveLength(2);
    expect(deps.runSubAnimation).toHaveBeenCalledWith("out", "in", "swap");
  });

  it("routes an incompatible bench player through position-swap selection", () => {
    const { result, deps, rerender } = setup([
      initialPlayers[0],
      { ...initialPlayers[1], assignedPositions: ["GK"] },
      initialPlayers[2],
    ]);
    deps.selectedOnPitch = "out";
    deps.selectedOnBench = "in";
    deps.players = deps.playersRef.current;
    rerender();
    expect(deps.setPendingSubBenchPlayer).toHaveBeenCalledWith("in");
    expect(deps.setRequiredPosition).toHaveBeenCalledWith("MID");
    expect(deps.setPositionSwapDialogOpen).toHaveBeenCalledWith(true);
    expect(result.current.manualSubConfirmOpen).toBe(false);
  });

  it("rejects stale confirmation when the outgoing player no longer occupies a slot", () => {
    const stale = initialPlayers.map((p) => p.id === "out" ? { ...p, position: null } : p);
    const { result, deps, getPlayers } = setup(stale);
    act(() => result.current.setPendingManualSub({ pitchPlayerId: "out", benchPlayerId: "in" }));
    act(() => result.current.handleConfirmManualSub());
    expect(getPlayers()).toEqual(stale);
    expect(deps.setPlayers).not.toHaveBeenCalled();
    expect(deps.runSubAnimation).not.toHaveBeenCalled();
  });

  it("cancel clears only the pending bench selection and never mutates lineup", () => {
    const { result, deps } = setup();
    act(() => result.current.setPendingManualSub({ pitchPlayerId: "out", benchPlayerId: "in" }));
    act(() => result.current.handleCancelManualSub());
    expect(deps.setPlayers).not.toHaveBeenCalled();
    expect(deps.setSelectedOnBench).toHaveBeenCalledWith(null);
  });
});
