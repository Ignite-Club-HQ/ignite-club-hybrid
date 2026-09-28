import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePitchBoardFormationChangeDialog, type FormationChangeDialogDeps } from "./usePitchBoardFormationChangeDialog";
import type { Player } from "../types";

const players = [{ id: "p1", name: "Alex", position: { x: 20, y: 50 } }] as Player[];
const details = {
  positionSwaps: [{ player: players[0], fromPosition: "MID" as const, toPosition: "FWD" as const }],
  benchMoves: [],
};

function setup(overrides: Partial<FormationChangeDialogDeps> = {}) {
  const deps: FormationChangeDialogDeps = {
    players,
    setPlayers: vi.fn(),
    setTeamSize: vi.fn(),
    setSelectedFormation: vi.fn(),
    autoPlacePlayersOnPitch: vi.fn(() => [{ ...players[0], position: { x: 40, y: 30 } }]),
    persistTeamSizeToDb: vi.fn(),
    notifyFormationOrSizeChange: vi.fn(),
    applyFormationChange: vi.fn(),
    setToolbarCollapsed: vi.fn(),
    setPortraitSheetOpen: vi.fn(),
    autoSubActive: false,
    regeneratePlanRef: createRef<(() => void) | null>(),
    toast: vi.fn(),
    ...overrides,
  };
  const ref = { current: deps };
  const hook = renderHook(() => usePitchBoardFormationChangeDialog(ref));
  return { deps, ...hook };
}

describe("pitchboard formation-change orchestration", () => {
  afterEach(() => vi.useRealTimers());

  it("applies a formation without changing team size and passes the exact movement audit", () => {
    const { result, deps } = setup();
    act(() => {
      result.current.setPendingFormationChange({ index: 2, ...details });
      result.current.setFormationChangeDialogOpen(true);
    });
    act(() => result.current.handleFormationChangeConfirm());
    expect(deps.applyFormationChange).toHaveBeenCalledWith(2, details);
    expect(deps.setTeamSize).not.toHaveBeenCalled();
    expect(deps.persistTeamSizeToDb).not.toHaveBeenCalled();
    expect(result.current.pendingFormationChange).toBeNull();
    expect(result.current.formationChangeDialogOpen).toBe(false);
  });

  it("changes team size atomically, resets formation, places players and persists once", () => {
    const { result, deps } = setup();
    act(() => result.current.setPendingFormationChange({ index: 3, newTeamSize: "7", ...details }));
    act(() => result.current.handleFormationChangeConfirm());
    expect(deps.setTeamSize).toHaveBeenCalledWith("7");
    expect(deps.setSelectedFormation).toHaveBeenCalledWith(0);
    expect(deps.autoPlacePlayersOnPitch).toHaveBeenCalledWith(players, "7", 0);
    expect(deps.setPlayers).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "p1" })]));
    expect(deps.persistTeamSizeToDb).toHaveBeenCalledTimes(1);
    expect(deps.notifyFormationOrSizeChange).toHaveBeenCalledWith("team_size", "7", details);
  });

  it("regenerates an active autosub plan only after the confirmed formation is applied", () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const regenerate = vi.fn(() => order.push("regenerate"));
    const { result } = setup({
      autoSubActive: true,
      applyFormationChange: vi.fn(() => order.push("formation")),
      regeneratePlanRef: { current: regenerate },
    });
    act(() => result.current.setPendingFormationChange({ index: 1, ...details }));
    act(() => result.current.handleFormationChangeConfirm());
    expect(order).toEqual(["formation"]);
    act(() => vi.advanceTimersByTime(300));
    expect(order).toEqual(["formation", "regenerate"]);
  });

  it("cancel leaves players, formation and autosubs untouched", () => {
    vi.useFakeTimers();
    const regenerate = vi.fn();
    const { result, deps } = setup({ autoSubActive: true, regeneratePlanRef: { current: regenerate } });
    act(() => {
      result.current.setPendingFormationChange({ index: 2, ...details });
      result.current.setFormationChangeDialogOpen(true);
    });
    act(() => result.current.handleFormationChangeCancel());
    act(() => vi.runAllTimers());
    expect(deps.applyFormationChange).not.toHaveBeenCalled();
    expect(deps.setPlayers).not.toHaveBeenCalled();
    expect(regenerate).not.toHaveBeenCalled();
  });
});
