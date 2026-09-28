import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef, type Dispatch, type SetStateAction } from "react";
import { usePitchBoardTimer } from "./usePitchBoardTimer";
import type { Player } from "../types";

/**
 * The half-1 → half-2 crossing formula in `handleTimerUpdate`
 * (`Math.max(0, halfDuration - lastUpdate.seconds) + Math.max(0, elapsedSeconds)`)
 * is documented as fragile but was pinned by no test. It has two sub-cases:
 *
 *   - normal wrap: GameTimer flips to H2 reporting elapsedSeconds === 0, so the
 *     unreported tail of H1 must still be credited;
 *   - resume / drift catch-up that lands mid-H2 with elapsedSeconds > 0, where
 *     BOTH the H1 remainder and the H2 head must be credited or per-player
 *     minutes silently under-count by the whole background window.
 *
 * Plus the `Math.min(next, totalElapsedNow)` cap, which is the last line of
 * defence against double-accumulation from duplicated ticks.
 */
const MINUTES_PER_HALF = 10;
const HALF = MINUTES_PER_HALF * 60;

function setup(initialPlayers: Player[]) {
  let players = initialPlayers;
  const setPlayersRef = createRef<Dispatch<SetStateAction<Player[]>> | null>() as {
    current: Dispatch<SetStateAction<Player[]>> | null;
  };
  setPlayersRef.current = (updater) => {
    players = typeof updater === "function"
      ? (updater as (p: Player[]) => Player[])(players)
      : updater;
  };

  const elapsed: number[] = [];
  const setElapsedGameTimeRef = { current: ((v: number) => { elapsed.push(v as number); }) as unknown as Dispatch<SetStateAction<number>> | null };
  const minutesPerHalfRef = { current: MINUTES_PER_HALF };
  const gameTimerRef = { current: { getMinutesPerHalf: () => MINUTES_PER_HALF } as never };
  const updateNextSubInfoRef = { current: vi.fn() };
  const checkForDueSubsRef = { current: vi.fn() };

  const hook = renderHook(() =>
    usePitchBoardTimer({
      teamId: "team-1",
      savedState: null,
      minutesPerHalfRef,
      gameTimerRef,
      setPlayersRef,
      setElapsedGameTimeRef,
      updateNextSubInfoRef,
      checkForDueSubsRef,
    }),
  );

  return { hook, get: () => players, elapsed, updateNextSubInfoRef, checkForDueSubsRef };
}

const onPitch = (): Player => ({ id: "p1", name: "On", position: 1, minutesPlayed: 0 } as unknown as Player);
const onBench = (): Player => ({ id: "p2", name: "Bench", position: null, minutesPlayed: 0 } as unknown as Player);

describe("usePitchBoardTimer handleTimerUpdate", () => {
  it("credits nothing on the very first tick (initialises the delta baseline)", () => {
    const { hook, get } = setup([onPitch()]);
    act(() => hook.result.current.handleTimerUpdate(120, 1));
    expect(get()[0].minutesPlayed).toBe(0);
  });

  it("credits the delta — not the absolute elapsed — on subsequent ticks", () => {
    const { hook, get } = setup([onPitch()]);
    act(() => hook.result.current.handleTimerUpdate(120, 1));
    act(() => hook.result.current.handleTimerUpdate(150, 1));
    expect(get()[0].minutesPlayed).toBe(30);
  });

  it("never credits a benched player", () => {
    const { hook, get } = setup([onPitch(), onBench()]);
    act(() => hook.result.current.handleTimerUpdate(0, 1));
    act(() => hook.result.current.handleTimerUpdate(60, 1));
    expect(get()[1].minutesPlayed).toBe(0);
  });

  it("credits the unreported tail of H1 on a normal halftime wrap", () => {
    const { hook, get } = setup([onPitch()]);
    act(() => hook.result.current.handleTimerUpdate(HALF - 5, 1));
    // GameTimer flips to H2 and reports 0.
    act(() => hook.result.current.handleTimerUpdate(0, 2));
    expect(get()[0].minutesPlayed).toBe(5);
  });

  it("credits H1 remainder AND the H2 head when a resume crosses halftime", () => {
    const { hook, get } = setup([onPitch()]);
    act(() => hook.result.current.handleTimerUpdate(HALF - 30, 1));
    // Backgrounded, resumed 90s later: 30s of H1 left + 60s into H2.
    act(() => hook.result.current.handleTimerUpdate(60, 2));
    expect(get()[0].minutesPlayed).toBe(90);
  });

  it("caps a player's minutes at total elapsed game time (double-tick defence)", () => {
    const { hook, get } = setup([{ ...onPitch(), minutesPlayed: HALF } as Player]);
    act(() => hook.result.current.handleTimerUpdate(0, 1));
    act(() => hook.result.current.handleTimerUpdate(60, 1));
    // Pre-inflated to 600s but only 60s of game has elapsed in H1.
    expect(get()[0].minutesPlayed).toBe(60);
  });

  it("never rewinds minutes when the same tick arrives twice", () => {
    const { hook, get } = setup([onPitch()]);
    act(() => hook.result.current.handleTimerUpdate(0, 1));
    act(() => hook.result.current.handleTimerUpdate(60, 1));
    act(() => hook.result.current.handleTimerUpdate(60, 1));
    expect(get()[0].minutesPlayed).toBe(60);
  });

  it("reports total elapsed across halves and always drives the sub checks", () => {
    const { hook, elapsed, updateNextSubInfoRef, checkForDueSubsRef } = setup([onPitch()]);
    act(() => hook.result.current.handleTimerUpdate(30, 1));
    act(() => hook.result.current.handleTimerUpdate(45, 2));
    expect(elapsed).toEqual([30, HALF + 45]);
    // Sub detection must run on EVERY tick, including the initialising one.
    expect(updateNextSubInfoRef.current).toHaveBeenCalledTimes(2);
    expect(checkForDueSubsRef.current).toHaveBeenCalledTimes(2);
  });

  it("flags the game in progress as soon as the clock moves", () => {
    const { hook } = setup([onPitch()]);
    expect(hook.result.current.gameInProgress).toBe(false);
    act(() => hook.result.current.handleTimerUpdate(1, 1));
    expect(hook.result.current.gameInProgress).toBe(true);
  });
});
