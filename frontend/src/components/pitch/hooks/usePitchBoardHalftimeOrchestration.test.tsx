import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameTimerRef } from "../GameTimer";
import type { Player } from "../types";
import {
  findHalftimeGoalkeeperSwap,
  usePitchBoardHalftimeOrchestration,
} from "./usePitchBoardHalftimeOrchestration";

const mocks = vi.hoisted(() => ({
  beep: vi.fn(),
  canShow: vi.fn(),
  hasAcknowledged: vi.fn(),
  loadTimer: vi.fn(),
}));

vi.mock("../GameTimer", () => ({ playSubAlertBeep: mocks.beep }));
vi.mock("../pitchStateUtils", () => ({
  loadTimerStateForMinutes: mocks.loadTimer,
}));
vi.mock("../halftimePromptAck", () => ({
  canShowHalftimePrompt: mocks.canShow,
  hasAcknowledgedHalftimePrompt: mocks.hasAcknowledged,
}));

const player = (
  id: string,
  name: string,
  position: { x: number; y: number } | null = null,
  currentPitchPosition?: Player["currentPitchPosition"],
): Player => ({ id, name, position, currentPitchPosition });

function setup({
  elapsedSeconds = 0,
  checkHalftimeSubs = vi.fn(() => false),
  preferredSecondHalfGkId,
  players = [],
}: {
  elapsedSeconds?: number;
  checkHalftimeSubs?: ReturnType<typeof vi.fn<(half: 1 | 2) => boolean>>;
  preferredSecondHalfGkId?: string;
  players?: Player[];
} = {}) {
  const timer = {
    getElapsedSeconds: vi.fn(() => elapsedSeconds),
  } as unknown as GameTimerRef;
  const setters = {
    setPendingAutoSub: vi.fn(),
    setPendingBatchSubs: vi.fn(),
    setSubConfirmDialogOpen: vi.fn(),
  };
  const { result } = renderHook(() => usePitchBoardHalftimeOrchestration({
    gameTimerRef: { current: timer },
    halftimePromptAckKey: "game-half-key",
    checkHalftimeSubs,
    preferredSecondHalfGkId,
    players,
    savedState: null,
    teamId: "team-1",
    ...setters,
  }));
  return { callback: result.current, checkHalftimeSubs, setters };
}

describe("findHalftimeGoalkeeperSwap", () => {
  const current = player("gk-1", "Jordan", { x: 50, y: 90 }, "GK");
  const next = player("gk-2", "Morgan");

  it("returns the on-pitch goalkeeper and distinct preferred replacement", () => {
    expect(findHalftimeGoalkeeperSwap([current, next], next.id)).toEqual({
      currentGk: current,
      secondHalfGk: next,
    });
  });

  it("does not propose a swap for a missing, benched or identical goalkeeper", () => {
    expect(findHalftimeGoalkeeperSwap([current, next])).toBeNull();
    expect(findHalftimeGoalkeeperSwap([current, next], current.id)).toBeNull();
    expect(findHalftimeGoalkeeperSwap([
      { ...current, position: null },
      next,
    ], next.id)).toBeNull();
  });
});

describe("usePitchBoardHalftimeOrchestration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.canShow.mockReturnValue(true);
    mocks.hasAcknowledged.mockReturnValue(false);
    mocks.loadTimer.mockReturnValue({
      currentHalf: 2,
      elapsedSeconds: 0,
      isRunning: false,
    });
  });

  afterEach(() => vi.useRealTimers());

  it("delegates every non-stale half change to the auto-sub scheduler first", () => {
    const checkHalftimeSubs = vi.fn(() => true);
    const { callback, setters } = setup({
      checkHalftimeSubs,
      preferredSecondHalfGkId: "gk-2",
      players: [
        player("gk-1", "Jordan", { x: 50, y: 90 }, "GK"),
        player("gk-2", "Morgan"),
      ],
    });

    callback(2, "live");
    act(() => vi.advanceTimersByTime(500));

    expect(checkHalftimeSubs).toHaveBeenCalledWith(2);
    expect(setters.setSubConfirmDialogOpen).not.toHaveBeenCalled();
    expect(mocks.beep).not.toHaveBeenCalled();
  });

  it("suppresses stale resume and acknowledged callbacks before scheduler work", () => {
    const stale = setup({ elapsedSeconds: 31 });
    stale.callback(2, "reconcile");
    expect(stale.checkHalftimeSubs).not.toHaveBeenCalled();

    mocks.hasAcknowledged.mockReturnValue(true);
    const acknowledged = setup();
    acknowledged.callback(2, "live");
    expect(acknowledged.checkHalftimeSubs).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens the exact preferred-goalkeeper substitution after the safety delay", () => {
    const current = player("gk-1", "Jordan", { x: 50, y: 90 }, "GK");
    const next = player("gk-2", "Morgan");
    const { callback, setters } = setup({
      preferredSecondHalfGkId: next.id,
      players: [current, next],
    });

    callback(2, "reconcile");
    act(() => vi.advanceTimersByTime(499));
    expect(setters.setSubConfirmDialogOpen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(mocks.loadTimer).toHaveBeenCalledWith("team-1");
    expect(mocks.canShow).toHaveBeenCalled();
    expect(mocks.beep).toHaveBeenCalledWith("Halftime GK swap: Jordan ➜ Morgan");
    expect(setters.setPendingAutoSub).toHaveBeenCalledWith({
      time: 0,
      half: 2,
      playerOut: current,
      playerIn: next,
      executed: false,
    });
    expect(setters.setPendingBatchSubs).toHaveBeenCalledWith([]);
    expect(setters.setSubConfirmDialogOpen).toHaveBeenCalledWith(true);
  });

  it("shows an empty informational prompt only for a live second-half boundary", () => {
    const reconciled = setup();
    reconciled.callback(2, "reconcile");
    act(() => vi.advanceTimersByTime(500));
    expect(reconciled.setters.setSubConfirmDialogOpen).not.toHaveBeenCalled();

    const live = setup();
    live.callback(2, "live");
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.beep).toHaveBeenCalledWith("Half Time!");
    expect(live.setters.setPendingAutoSub).toHaveBeenCalledWith(null);
    expect(live.setters.setPendingBatchSubs).toHaveBeenCalledWith([]);
    expect(live.setters.setSubConfirmDialogOpen).toHaveBeenCalledWith(true);
  });

  it("cancels a delayed prompt when the timer is no longer at halftime", () => {
    mocks.canShow.mockReturnValue(false);
    const { callback, setters } = setup({
      preferredSecondHalfGkId: "gk-2",
      players: [
        player("gk-1", "Jordan", { x: 50, y: 90 }, "GK"),
        player("gk-2", "Morgan"),
      ],
    });

    callback(2, "live");
    act(() => vi.advanceTimersByTime(500));

    expect(mocks.canShow).toHaveBeenCalled();
    expect(mocks.beep).not.toHaveBeenCalled();
    expect(setters.setPendingAutoSub).not.toHaveBeenCalled();
    expect(setters.setSubConfirmDialogOpen).not.toHaveBeenCalled();
  });

  it("does not schedule PitchBoard fallback UI for first-half callbacks", () => {
    const { callback, checkHalftimeSubs, setters } = setup();
    callback(1, "live");
    act(() => vi.advanceTimersByTime(500));

    expect(checkHalftimeSubs).toHaveBeenCalledWith(1);
    expect(setters.setSubConfirmDialogOpen).not.toHaveBeenCalled();
    expect(mocks.beep).not.toHaveBeenCalled();
  });
});
