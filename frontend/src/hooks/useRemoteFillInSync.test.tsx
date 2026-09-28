import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, channel, removeChannel, channels, fetchState } = vi.hoisted(() => ({
  from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), channels: new Map<string, any>(), fetchState: { data: null as any, error: null as any },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, channel, removeChannel } }));

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
    vi.spyOn(Date, "now").mockReturnValue(now); from.mockImplementation(query); channel.mockImplementation(makeChannel);
  });

  it("does not query or subscribe when disabled, missing a team, or using an event-group pseudo-team", () => {
    renderHook(() => useRemoteFillInSync("team-1", false));
    renderHook(() => useRemoteFillInSync(null, true));
    renderHook(() => useRemoteFillInSync("event-group-123", true));
    expect(from).not.toHaveBeenCalled(); expect(channel).not.toHaveBeenCalled();
  });

  it("loads only valid fill-ins from a fresh active row", async () => {
    fetchState.data = freshRow;
    const { result } = renderHook(() => useRemoteFillInSync("team-1", true));
    await waitFor(() => expect(result.current).toEqual([fillIn]));
    expect(from).toHaveBeenCalledWith("active_games");
  });

  it.each([
    [{ ...freshRow, updated_at: new Date(now - 12 * 60 * 60 * 1000 - 1).toISOString() }, "stale row"],
    [{ ...freshRow, timer_state: { is_game_finished: true, lastUpdateTime: now } }, "snake-case finished timer"],
    [{ ...freshRow, timer_state: { isGameFinished: true, lastUpdateTime: now } }, "camel-case finished timer"],
    [{ ...freshRow, timer_state: { lastUpdateTime: now - 12 * 60 * 60 * 1000 - 1 } }, "stale timer"],
  ])("rejects fill-ins from a %s", async (row) => {
    fetchState.data = row;
    const { result } = renderHook(() => useRemoteFillInSync("team-1", true));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual([]);
  });

  it("scopes realtime to the exact team and clears when the game becomes inactive", async () => {
    const { result } = renderHook(() => useRemoteFillInSync("team-1", true));
    await act(async () => { await Promise.resolve(); });
    const record = channels.get("soccer-fillins-team-1");
    expect(record.config).toEqual({ event: "*", schema: "public", table: "active_games", filter: "team_id=eq.team-1" });
    act(() => record.handler({ new: freshRow }));
    expect(result.current).toEqual([fillIn]);
    act(() => record.handler({ new: { ...freshRow, is_active: false } }));
    expect(result.current).toEqual([]);
  });

  it("removes the previous team channel before switching and on unmount", () => {
    const { rerender, unmount } = renderHook(({ teamId }) => useRemoteFillInSync(teamId, true), { initialProps: { teamId: "team-1" } });
    const first = channels.get("soccer-fillins-team-1");
    rerender({ teamId: "team-2" });
    const second = channels.get("soccer-fillins-team-2");
    expect(removeChannel).toHaveBeenCalledWith(first);
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(second);
  });
});
