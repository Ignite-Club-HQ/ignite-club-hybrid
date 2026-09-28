import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameTimerRef } from "../GameTimer";
import type { Player } from "../types";
import {
  resolveDefaultFormationIndex,
  usePitchBoardResetGame,
} from "./usePitchBoardResetGame";

const mocks = vi.hoisted(() => ({ clearPitchState: vi.fn() }));
vi.mock("../pitchStateUtils", () => ({ clearPitchState: mocks.clearPitchState }));

const player = (
  id: string,
  name: string,
  options: Partial<Player> = {},
): Player => ({
  id,
  name,
  position: null,
  minutesPlayed: 420,
  ...options,
});

function setup(players: Player[] = [
  player("starter", "Alex", { position: { x: 45, y: 70 } }),
  player("bench", "Blake"),
  player("fill-in", "Casey", { isFillIn: true, position: { x: 55, y: 30 } }),
]) {
  const resetTimer = vi.fn();
  const autoPlacePlayersOnPitch = vi.fn((roster: Player[]) => (
    roster.map((candidate, index) => ({
      ...candidate,
      position: index === 0 ? { x: 50, y: 90 } : null,
    }))
  ));
  const setters = {
    setMinutesPerHalf: vi.fn(),
    setRotationSpeed: vi.fn(),
    setDisablePositionSwaps: vi.fn(),
    setDisableBatchSubs: vi.fn(),
    setRotateGkAtHalftime: vi.fn(),
    setMaxSpreadMinutes: vi.fn(),
    setTeamSize: vi.fn(),
    setSelectedFormation: vi.fn(),
    setPlayers: vi.fn(),
    setAutoSubPlan: vi.fn(),
    setAutoSubActive: vi.fn(),
    setAutoSubPaused: vi.fn(),
    setSubMode: vi.fn(),
    setSelectedOnPitch: vi.fn(),
    setSelectedOnBench: vi.fn(),
    setGameInProgress: vi.fn(),
    setTimerResetKey: vi.fn(),
  };
  const savedTeamDefaultsRef = { current: {
    minutesPerHalf: 25,
    rotationSpeed: 2,
    disablePositionSwaps: true,
    disableBatchSubs: true,
    rotateGkAtHalftime: false,
    maxSpreadMinutes: 4,
    teamSize: "7" as const,
    formation: "3-2-1",
  } };
  const hasLoadedRef = { current: true };
  const notifyReset = vi.fn();
  const args = {
    teamId: "team-1",
    players,
    gameTimerRef: {
      current: { resetTimer } as unknown as GameTimerRef,
    },
    savedTeamDefaultsRef,
    hasLoadedRef,
    autoPlacePlayersOnPitch,
    ...setters,
    notifyReset,
  };
  const hook = renderHook(
    ({ value }) => usePitchBoardResetGame(value),
    { initialProps: { value: args } },
  );
  return {
    ...hook,
    args,
    resetTimer,
    autoPlacePlayersOnPitch,
    setters,
    savedTeamDefaultsRef,
    hasLoadedRef,
    notifyReset,
  };
}

describe("resolveDefaultFormationIndex", () => {
  it("selects the saved formation and safely falls back to the first formation", () => {
    expect(resolveDefaultFormationIndex("7", "3-2-1")).toBe(1);
    expect(resolveDefaultFormationIndex("7", "missing-formation")).toBe(0);
    expect(resolveDefaultFormationIndex("7", null)).toBe(0);
  });
});

describe("usePitchBoardResetGame", () => {
  beforeEach(() => vi.clearAllMocks());

  it("performs a full reset from saved team defaults and removes game-only fill-ins", () => {
    const {
      result,
      args,
      resetTimer,
      autoPlacePlayersOnPitch,
      setters,
      hasLoadedRef,
      notifyReset,
    } = setup();

    act(() => result.current());

    expect(resetTimer).toHaveBeenCalledOnce();
    expect(setters.setMinutesPerHalf).toHaveBeenCalledWith(25);
    expect(setters.setRotationSpeed).toHaveBeenCalledWith(2);
    expect(setters.setDisablePositionSwaps).toHaveBeenCalledWith(true);
    expect(setters.setDisableBatchSubs).toHaveBeenCalledWith(true);
    expect(setters.setRotateGkAtHalftime).toHaveBeenCalledWith(false);
    expect(setters.setMaxSpreadMinutes).toHaveBeenCalledWith(4);
    expect(setters.setTeamSize).toHaveBeenCalledWith("7");
    expect(setters.setSelectedFormation).toHaveBeenCalledWith(1);
    expect(autoPlacePlayersOnPitch).toHaveBeenCalledWith([
      { ...args.players[0], minutesPlayed: 0 },
      { ...args.players[1], minutesPlayed: 0 },
    ], "7", 1);
    expect(setters.setPlayers).toHaveBeenCalledWith([
      { ...args.players[0], minutesPlayed: 0, position: { x: 50, y: 90 } },
      { ...args.players[1], minutesPlayed: 0, position: null },
    ]);
    expect(setters.setAutoSubPlan).toHaveBeenCalledWith([]);
    expect(setters.setAutoSubActive).toHaveBeenCalledWith(false);
    expect(setters.setAutoSubPaused).toHaveBeenCalledWith(false);
    expect(mocks.clearPitchState).toHaveBeenCalledWith("team-1");
    expect(hasLoadedRef.current).toBe(false);
    expect(notifyReset).toHaveBeenCalledOnce();
  });

  it("always clears transient selection state and remounts the timer", () => {
    const { result, setters } = setup();
    act(() => result.current());

    expect(setters.setSubMode).toHaveBeenCalledWith(false);
    expect(setters.setSelectedOnPitch).toHaveBeenCalledWith(null);
    expect(setters.setSelectedOnBench).toHaveBeenCalledWith(null);
    expect(setters.setGameInProgress).toHaveBeenCalledWith(false);
    const increment = setters.setTimerResetKey.mock.calls[0][0];
    expect(increment(8)).toBe(9);
  });

  it("stops the timer before changing state or clearing persistence", () => {
    const { result, resetTimer, setters } = setup();
    act(() => result.current());

    expect(resetTimer.mock.invocationCallOrder[0])
      .toBeLessThan(setters.setMinutesPerHalf.mock.invocationCallOrder[0]);
    expect(resetTimer.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.clearPitchState.mock.invocationCallOrder[0]);
  });

  it("preserves lineup, settings, plan and persistence when only resetting a finished clock", () => {
    const currentPlayers = [
      player("starter", "Alex", { position: { x: 45, y: 70 }, minutesPlayed: 700 }),
      player("fill-in", "Casey", { isFillIn: true, position: { x: 55, y: 30 }, minutesPlayed: 320 }),
    ];
    const {
      result,
      setters,
      autoPlacePlayersOnPitch,
      hasLoadedRef,
    } = setup(currentPlayers);

    act(() => result.current(true, { preserveLineup: true }));

    const updatePlayers = setters.setPlayers.mock.calls[0][0];
    expect(updatePlayers(currentPlayers)).toEqual(currentPlayers.map((candidate) => ({
      ...candidate,
      minutesPlayed: 0,
    })));
    expect(autoPlacePlayersOnPitch).not.toHaveBeenCalled();
    expect(setters.setMinutesPerHalf).not.toHaveBeenCalled();
    expect(setters.setTeamSize).not.toHaveBeenCalled();
    expect(setters.setSelectedFormation).not.toHaveBeenCalled();
    expect(setters.setAutoSubPlan).not.toHaveBeenCalled();
    expect(setters.setAutoSubActive).not.toHaveBeenCalled();
    expect(setters.setAutoSubPaused).not.toHaveBeenCalled();
    expect(mocks.clearPitchState).not.toHaveBeenCalled();
    expect(hasLoadedRef.current).toBe(true);
  });

  it("suppresses only the confirmation toast for silent resets", () => {
    const { result, resetTimer, setters, notifyReset } = setup();
    act(() => result.current(true));

    expect(resetTimer).toHaveBeenCalledOnce();
    expect(setters.setPlayers).toHaveBeenCalled();
    expect(mocks.clearPitchState).toHaveBeenCalledWith("team-1");
    expect(notifyReset).not.toHaveBeenCalled();
  });

  it("uses the latest roster supplied after a re-render", () => {
    const original = [player("one", "Alex")];
    const latest = [player("one", "Alex"), player("two", "Blake")];
    const { result, rerender, args, autoPlacePlayersOnPitch } = setup(original);
    rerender({ value: { ...args, players: latest } });

    act(() => result.current());

    expect(autoPlacePlayersOnPitch).toHaveBeenCalledWith(
      latest.map((candidate) => ({ ...candidate, minutesPlayed: 0 })),
      "7",
      1,
    );
  });
});
