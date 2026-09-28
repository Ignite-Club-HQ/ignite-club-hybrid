import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: any) => void;
const { channel, removeChannel, setQueryData, invalidateQueries, channels } = vi.hoisted(() => ({
  channel: vi.fn(),
  removeChannel: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  channels: new Map<string, { name: string; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; handler?: Handler; config?: any }>(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { channel, removeChannel } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData, invalidateQueries }),
  useQuery: (options: any) => ({ data: options.initialData, isLoading: false, options }),
}));

import { groupChatUnreadCacheKey, useGroupChatUnreadCache } from "./useGroupChatUnreadCache";

function makeChannel(name: string) {
  const record: any = { name };
  record.on = vi.fn((_event: string, config: any, handler: Handler) => {
    record.config = config;
    record.handler = handler;
    return record;
  });
  record.subscribe = vi.fn(() => record);
  channels.set(name, record);
  return record;
}

describe("useGroupChatUnreadCache realtime scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channels.clear();
    channel.mockImplementation(makeChannel);
  });

  it("does not subscribe when there is no authenticated user", () => {
    renderHook(() => useGroupChatUnreadCache(null));
    expect(channel).not.toHaveBeenCalled();
    expect(groupChatUnreadCacheKey(null)).toEqual(["chat-group-unread-cache", null]);
  });

  it("creates exactly three user-scoped channels with protected cache/read filters", () => {
    renderHook(() => useGroupChatUnreadCache("user-1"));

    expect(channel.mock.calls.map(([name]) => name)).toEqual([
      "chat-group-unread-user-1",
      "chat-group-unread-msgs-user-1",
      "chat-group-unread-reads-user-1",
    ]);
    expect(channels.get("chat-group-unread-user-1")?.config).toEqual({
      event: "*", schema: "public", table: "chat_group_unread", filter: "user_id=eq.user-1",
    });
    expect(channels.get("chat-group-unread-reads-user-1")?.config).toEqual({
      event: "INSERT", schema: "public", table: "message_reads", filter: "user_id=eq.user-1",
    });
    expect([...channels.values()].every((entry) => entry.subscribe.mock.calls.length === 1)).toBe(true);
  });

  it("patches only the payload group and removes zero or deleted counts", () => {
    renderHook(() => useGroupChatUnreadCache("user-1"));
    const handler = channels.get("chat-group-unread-user-1")!.handler!;

    act(() => handler({ eventType: "UPDATE", new: { group_id: "group-1", unread_count: 4 } }));
    let updater = setQueryData.mock.calls.at(-1)![1];
    expect(updater({ "group-2": 2 })).toEqual({ "group-1": 4, "group-2": 2 });

    act(() => handler({ eventType: "UPDATE", new: { group_id: "group-1", unread_count: 0 } }));
    updater = setQueryData.mock.calls.at(-1)![1];
    expect(updater({ "group-1": 4, "group-2": 2 })).toEqual({ "group-2": 2 });

    act(() => handler({ eventType: "DELETE", old: { group_id: "group-2", unread_count: 2 }, new: null }));
    updater = setQueryData.mock.calls.at(-1)![1];
    expect(updater({ "group-2": 2, "group-3": 1 })).toEqual({ "group-3": 1 });
  });

  it("coalesces bursts of message and read events into one cache invalidation per frame", async () => {
    vi.useFakeTimers();
    renderHook(() => useGroupChatUnreadCache("user-1"));
    const messageHandler = channels.get("chat-group-unread-msgs-user-1")!.handler!;
    const readHandler = channels.get("chat-group-unread-reads-user-1")!.handler!;

    act(() => {
      messageHandler({});
      messageHandler({});
      readHandler({});
      vi.advanceTimersByTime(16);
    });

    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["chat-group-unread-cache", "user-1"] });
    vi.useRealTimers();
  });

  it("removes all old-user channels before subscribing for a new user", () => {
    const { rerender } = renderHook(({ userId }) => useGroupChatUnreadCache(userId), {
      initialProps: { userId: "user-1" as string | null },
    });
    const oldChannels = [
      channels.get("chat-group-unread-user-1"),
      channels.get("chat-group-unread-msgs-user-1"),
      channels.get("chat-group-unread-reads-user-1"),
    ];

    rerender({ userId: "user-2" });

    expect(removeChannel.mock.calls.map(([removed]) => removed)).toEqual(oldChannels);
    expect(channels.has("chat-group-unread-user-2")).toBe(true);
    expect(channels.has("chat-group-unread-msgs-user-2")).toBe(true);
    expect(channels.has("chat-group-unread-reads-user-2")).toBe(true);
  });

  it("removes every active channel on unmount", () => {
    const { unmount } = renderHook(() => useGroupChatUnreadCache("user-1"));
    const active = [...channels.values()];
    unmount();
    expect(removeChannel.mock.calls.map(([removed]) => removed)).toEqual(active);
  });
});
