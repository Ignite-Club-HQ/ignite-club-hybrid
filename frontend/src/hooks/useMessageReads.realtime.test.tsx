import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { channel, removeChannel, from, onAuthStateChange, channels, mutationCalls } = vi.hoisted(() => ({
  channel: vi.fn(), removeChannel: vi.fn(), from: vi.fn(), onAuthStateChange: vi.fn(), channels: new Map<string, any>(), mutationCalls: [] as string[][],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel, removeChannel, from, auth: { onAuthStateChange, getSession: vi.fn() }, rpc: vi.fn() },
}));
vi.mock("@/lib/profileCache", () => ({
  selectCachedProfilesByIds: vi.fn().mockResolvedValue({ data: [] }),
  selectCachedProfileById: vi.fn().mockResolvedValue({ data: null }),
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: any) => ({ mutate: vi.fn((ids: string[]) => { mutationCalls.push(ids); options.onMutate?.(ids); }) }),
}));

import { useMessageReads } from "./useMessageReads";

function queryResult() {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.in = vi.fn(() => new Promise(() => {}));
  return chain;
}

function makeChannel(name: string) {
  const record: any = { name };
  record.on = vi.fn((_event: string, config: any, handler: (payload: any) => void) => {
    record.config = config; record.handler = handler; return record;
  });
  record.subscribe = vi.fn((handler: (status: string) => void) => { record.status = handler; return record; });
  channels.set(name, record);
  return record;
}

describe("useMessageReads realtime scoping", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    channels.clear();
    mutationCalls.length = 0;
    channel.mockImplementation(makeChannel);
    from.mockImplementation(() => queryResult());
  });

  it.each([
    ["team", "team-1", "team-1"],
    ["club", "club-1", "club-1"],
    ["group", "group-1", "group-1"],
    ["dm", "dm-1", "dm-1"],
    ["broadcast", "broadcast-feed", "broadcast"],
  ] as const)("subscribes %s reads using the correct scope filter", (type, contextId, scopeKey) => {
    renderHook(() => useMessageReads(type, contextId, ["message-1"], "user-1"));
    const record = channels.get(`message-reads-${type}-${contextId}`);
    expect(record.config).toEqual({
      event: "INSERT", schema: "public", table: "message_reads", filter: `scope_key=eq.${scopeKey}`,
    });
  });

  it("does not rebuild the channel when only the visible message window changes", () => {
    const { rerender } = renderHook(({ ids }) => useMessageReads("team", "team-1", ids, "user-1"), {
      initialProps: { ids: ["message-1"] },
    });
    const first = channels.get("message-reads-team-team-1");
    rerender({ ids: ["message-2", "message-3"] });
    expect(channel).toHaveBeenCalledTimes(1);
    expect(removeChannel).not.toHaveBeenCalledWith(first);
  });

  it("ignores realtime reads for messages outside the current visible window", async () => {
    const { result } = renderHook(() => useMessageReads("team", "team-1", ["message-1"], "user-1"));
    const record = channels.get("message-reads-team-team-1");
    await act(async () => record.handler({ new: { team_message_id: "foreign-message", user_id: "user-2" } }));
    expect(result.current.readCounts).toEqual({});
  });

  it("increments a visible read once and does not add the current user to the public frontier", async () => {
    const { result } = renderHook(() => useMessageReads("team", "team-1", ["message-1"], "user-1"));
    const record = channels.get("message-reads-team-team-1");
    await waitFor(() => expect(from).toHaveBeenCalledWith("message_reads"));
    await act(async () => record.handler({ new: { team_message_id: "message-1", user_id: "user-1" } }));
    expect(result.current.readCounts).toEqual({ "message-1": 1 });
    expect(result.current.readFrontier).toEqual({});
  });

  it("batches visible reads once and suppresses duplicate visibility notifications", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useMessageReads(
      "team", "team-1", ["message-1", "message-2"], "user-batch",
    ));

    act(() => {
      result.current.markMessagesAsRead(["message-1", "message-2"]);
      result.current.markMessagesAsRead(["message-1", "message-2"]);
      vi.advanceTimersByTime(1_000);
    });

    expect(mutationCalls).toEqual([["message-1", "message-2"]]);
    expect(result.current.readCounts).toEqual({ "message-1": 1, "message-2": 1 });
    unmount();
    vi.useRealTimers();
  });

  it("keeps unread state isolated when the authenticated user changes", () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(({ userId }) => useMessageReads(
      "club", "club-1", ["message-1"], userId,
    ), { initialProps: { userId: "user-a" } });

    act(() => {
      result.current.markMessagesAsRead(["message-1"]);
      vi.advanceTimersByTime(1_000);
    });
    rerender({ userId: "user-b" });
    act(() => {
      result.current.markMessagesAsRead(["message-1"]);
      vi.advanceTimersByTime(1_000);
    });

    expect(mutationCalls).toEqual([["message-1"], ["message-1"]]);
    unmount();
    vi.useRealTimers();
  });

  it("reconciles on subscription and reconnect notifications", async () => {
    renderHook(() => useMessageReads("group", "group-1", ["message-1"], "user-1"));
    const record = channels.get("message-reads-group-group-1");
    const callsBefore = from.mock.calls.length;
    act(() => record.status("SUBSCRIBED"));
    await waitFor(() => expect(from.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("removes the previous scope channel before subscribing to a new context", () => {
    const { rerender, unmount } = renderHook(({ id }) => useMessageReads("team", id, ["message-1"], "user-1"), {
      initialProps: { id: "team-1" },
    });
    const first = channels.get("message-reads-team-team-1");
    rerender({ id: "team-2" });
    const second = channels.get("message-reads-team-team-2");
    expect(removeChannel).toHaveBeenCalledWith(first);
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(second);
  });
});
