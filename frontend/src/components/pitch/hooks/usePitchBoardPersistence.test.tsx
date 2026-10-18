import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { savePitchState, from, update, eq, then, dbResult, syncLiveActiveGame } = vi.hoisted(() => {
  const dbResult = { error: null as unknown };
  const eq = vi.fn();
  const then = vi.fn();
  const update = vi.fn();
  const from = vi.fn();
  return { savePitchState: vi.fn(), from, update, eq, then, dbResult, syncLiveActiveGame: vi.fn().mockResolvedValue(undefined) };
});
const icpMode = process.env.IGNITE_TEST_BACKEND_MODE === "icp";

vi.mock("../pitchStateUtils", () => ({ savePitchState }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => icpMode ? "icp" : "supabase" }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: unknown, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    icpMode ? providers.icp({}) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({ syncLiveActiveGame }));

import { usePitchBoardPersistence } from "./usePitchBoardPersistence";

function props(overrides: Record<string, unknown> = {}) {
  return {
    hasInitialized: true,
    teamId: "team-1",
    userId: "user-1",
    players: [{ id: "p1", name: "Alex", position: null }],
    teamSize: 7,
    selectedFormation: 2,
    ballPosition: { x: 50, y: 50 },
    autoSubPlan: [],
    autoSubActive: false,
    autoSubPaused: false,
    mockMode: false,
    linkedEventId: "event-1",
    goals: [],
    isEventGroup: false,
    forceEventGroupSync: vi.fn(),
    touchDragPlayer: null,
    draggedPlayer: null,
    ...overrides,
  } as any;
}

describe("usePitchBoardPersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    dbResult.error = null;
    const query = { eq, then };
    eq.mockReturnValue(query);
    then.mockImplementation((resolve: (result: typeof dbResult) => unknown) =>
      Promise.resolve(resolve(dbResult))
    );
    update.mockReturnValue(query);
    from.mockReturnValue({ update });
  });

  it("does not persist hydration defaults before initialization completes", () => {
    renderHook(() => usePitchBoardPersistence(props({ hasInitialized: false })));
    act(() => vi.runAllTimers());

    expect(savePitchState).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("writes the complete game snapshot immediately when the board is idle", () => {
    const input = props();
    renderHook(() => usePitchBoardPersistence(input));
    act(() => vi.advanceTimersByTime(0));

    expect(savePitchState).toHaveBeenCalledOnce();
    expect(savePitchState).toHaveBeenCalledWith("team-1", expect.objectContaining({
      players: input.players,
      teamSize: 7,
      linkedEventId: "event-1",
      goals: [],
    }));
  });

  it("debounces local writes during drag and saves only the latest snapshot", () => {
    const initial = props({ draggedPlayer: { id: "p1" } });
    const { rerender } = renderHook(
      ({ input }) => usePitchBoardPersistence(input),
      { initialProps: { input: initial } },
    );
    act(() => vi.advanceTimersByTime(200));
    expect(savePitchState).not.toHaveBeenCalled();

    const latestPlayers = [{ id: "p1", name: "Alex", position: { x: 20, y: 40 } }];
    rerender({ input: props({ draggedPlayer: { id: "p1" }, players: latestPlayers }) });
    act(() => vi.advanceTimersByTime(299));
    expect(savePitchState).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(savePitchState).toHaveBeenCalledOnce();
    expect(savePitchState).toHaveBeenCalledWith("team-1", expect.objectContaining({ players: latestPlayers }));
  });

  it("triggers event-group synchronization after the local snapshot is saved", () => {
    const forceEventGroupSync = vi.fn();
    renderHook(() => usePitchBoardPersistence(props({ isEventGroup: true, forceEventGroupSync })));
    act(() => vi.advanceTimersByTime(0));

    expect(savePitchState).toHaveBeenCalledOnce();
    expect(forceEventGroupSync).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode)("mirrors an active autosub plan to the active game for unlinked boards", async () => {
    const plan = [{
      half: 1,
      time: 300,
      playerOut: { id: "p1" },
      playerIn: { id: "p2" },
      executed: false,
    }];
    renderHook(() => usePitchBoardPersistence(props({ linkedEventId: null, autoSubActive: true, autoSubPlan: plan })));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });

    expect(from).toHaveBeenCalledWith("active_games");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      pitch_state: expect.objectContaining({ autoSubActive: true, autoSubPlan: plan, linkedEventId: null }),
      updated_at: expect.any(String),
    }));
    expect(eq).toHaveBeenCalledWith("team_id", "team-1");
    expect(eq).toHaveBeenCalledWith("is_active", true);
  });

  it.each([
    ["inactive plans", { autoSubActive: false }],
    ["anonymous boards", { userId: undefined, autoSubActive: true }],
    ["event-group boards", { isEventGroup: true, autoSubActive: true }],
  ])("does not mirror %s into active_games", async (_name, overrides) => {
    renderHook(() => usePitchBoardPersistence(props(overrides)));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(from).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode)("does not repeat a backend write when rerendered with an equivalent plan", async () => {
    const plan = [{ half: 1, time: 300, playerOut: { id: "p1" }, playerIn: { id: "p2" }, executed: false }];
    const { rerender } = renderHook(
      ({ input }) => usePitchBoardPersistence(input),
      { initialProps: { input: props({ autoSubActive: true, autoSubPlan: plan }) } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(from).toHaveBeenCalledTimes(1);

    rerender({ input: props({ autoSubActive: true, autoSubPlan: [...plan] }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it.runIf(icpMode)("persists the active plan on-chain without Supabase writes", async () => {
    const autoSubPlan = [{ half: 1, time: 300, playerOut: { id: "p1" }, playerIn: { id: "p2" }, executed: false }];
    renderHook(() => usePitchBoardPersistence(props({ autoSubActive: true, autoSubPlan })));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(savePitchState).toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(syncLiveActiveGame).toHaveBeenCalledWith({}, expect.objectContaining({ teamId: "team-1", boardSessionId: "pitch-team-1" }));
    const saved = syncLiveActiveGame.mock.calls[0]?.[1];
    expect(JSON.parse(saved.pitchStateJson)).toMatchObject({ autoSubActive: true, autoSubPlan });
  });
});
