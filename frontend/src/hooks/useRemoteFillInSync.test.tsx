import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, channel, removeChannel, channels, fetchState, getLiveActiveGame, icpMode } = vi.hoisted(() => ({
  from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), channels: new Map<string, any>(), fetchState: { data: null as any, error: null as any },
  getLiveActiveGame: vi.fn(),
  icpMode: process.env.IGNITE_TEST_BACKEND_MODE === "icp",
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, channel, removeChannel } }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => (icpMode ? "icp" : "supabase") }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, handlers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    icpMode ? handlers.icp({}) : handlers.supabase(),
}));
vi.mock("@/live/features/events", () => ({ getLiveActiveGame }));

import { useRemoteFillInSync } from "./useRemoteFillInSync";

function query() {
  const chain: any = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: fetchState.data, error: fetchState.error }));
  return chain;
}
function makeChannel(name: string) {
  const record: any = { name };
  record.on = vi.fn((_event: string, config: any, handler: any) => { record.config = config; record.handler = handler; return record; });
  record.subscribe = vi.fn(() => record); channels.set(name, record); return record;
}
const now = new Date("2026-07-19T12:00:00Z").getTime();
const fillIn = { id: "fill-1", name: "Guest", isFillIn: true };
const member = { id: "member-1", name: "Member", isFillIn: false };
const freshRow = { pitch_state: { players: [fillIn, member] }, timer_state: { lastUpdateTime: now }, updated_at: new Date(now).toISOString(), is_active: true };

describe("useRemoteFillInSync", () => {
  beforeEach(() => {
    vi.clearAllMocks(); channels.clear(); fetchState.data = null; fetchState.error = null;
    getLiveActiveGame.mockResolvedValue([]);
    vi.spyOn(Date, "now").mockReturnValue(now); from.mockImplementation(query); channel.mockImplementation(makeChannel);
  });

  it("does not query or subscribe when disabled, missing a team, or using an event-group pseudo-team", () => {
    renderHook(() => useRemoteFillInSync("team-1", false));
    renderHook(() => useRemoteFillInSync(null, true));
    renderHook(() => useRemoteFillInSync("event-group-123", true));
    expect(from).not.toHaveBeenCalled(); expect(channel).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode)("loads only valid fill-ins from a fresh active row", async () => {
    fetchState.data = freshRow;
    const { result } = renderHook(() => useRemoteFillInSync("team-1", true));
    await waitFor(() => expect(result.current).toEqual([fillIn]));
    expect(from).toHaveBeenCalledWith("active_games");
  });

  type ActiveGameRow = { pitch_state: unknown; timer_state: unknown; updated_at: string; is_active: boolean };
  const rejectedRows: Array<[ActiveGameRow, string]> = [
    [{ ...freshRow, updated_at: new Date(now - 12 * 60 * 60 * 1000 - 1).toISOString() }, "stale row"],
    [{ ...freshRow, timer_state: { is_game_finished: true, lastUpdateTime: now } }, "snake-case finished timer"],
    [{ ...freshRow, timer_state: { isGameFinished: true, lastUpdateTime: now } }, "camel-case finished timer"],
    [{ ...freshRow, timer_state: { lastUpdateTime: now - 12 * 60 * 60 * 1000 - 1 } }, "stale timer"],
  ];
  it.runIf(!icpMode).each(rejectedRows)("rejects fill-ins from a %s", async (row) => {
    fetchState.data = row;
    const { result } = renderHook(() => useRemoteFillInSync("team-1", true));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual([]);
  });

  it.runIf(!icpMode)("scopes realtime to the exact team and clears when the game becomes inactive", async () => {
    const { result } = renderHook(() => useRemoteFillInSync("team-1", true));
    await act(async () => { await Promise.resolve(); });
    const record = channels.get("soccer-fillins-team-1");
    expect(record.config).toEqual({ event: "*", schema: "public", table: "active_games", filter: "team_id=eq.team-1" });
    act(() => record.handler({ new: freshRow }));
    expect(result.current).toEqual([fillIn]);
    act(() => record.handler({ new: { ...freshRow, is_active: false } }));
    expect(result.current).toEqual([]);
  });

  it.runIf(!icpMode)("removes the previous team channel before switching and on unmount", () => {
    const { rerender, unmount } = renderHook(({ teamId }) => useRemoteFillInSync(teamId, true), { initialProps: { teamId: "team-1" } });
    const first = channels.get("soccer-fillins-team-1");
    rerender({ teamId: "team-2" });
    const second = channels.get("soccer-fillins-team-2");
    expect(removeChannel).toHaveBeenCalledWith(first);
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(second);
  });

  it.runIf(icpMode)("loads fresh fill-ins through events_domain and skips Supabase queries and channels", async () => {
    getLiveActiveGame.mockResolvedValue([{
      pitch_state_json: JSON.stringify({ players: [fillIn, member] }),
      timer_state_json: JSON.stringify({ lastUpdateTime: now }),
      updated_at_ms: BigInt(now),
      is_active: true,
    }]);
    const { result } = renderHook(() => useRemoteFillInSync("team-1", true));
    await waitFor(() => expect(result.current).toEqual([fillIn]));
    expect(getLiveActiveGame).toHaveBeenCalledWith({}, "team-1");
    expect(from).not.toHaveBeenCalled();
    expect(channel).not.toHaveBeenCalled();
  });

  it.runIf(icpMode)("rejects stale live active-game fill-ins", async () => {
    getLiveActiveGame.mockResolvedValue([{
      pitch_state_json: JSON.stringify({ players: [fillIn, member] }),
      timer_state_json: JSON.stringify({ lastUpdateTime: now - 12 * 60 * 60 * 1000 - 1 }),
      updated_at_ms: BigInt(now),
      is_active: true,
    }]);
    const { result } = renderHook(() => useRemoteFillInSync("team-1", true));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it.runIf(icpMode)("clears the canister polling timer on unmount", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useRemoteFillInSync("team-1", true));
    const pollTimer = setIntervalSpy.mock.results.at(-1)?.value;

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimer);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
