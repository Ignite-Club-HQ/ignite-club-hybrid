import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { channel, removeChannel, channels } = vi.hoisted(() => ({ channel: vi.fn(), removeChannel: vi.fn(), channels: new Map<string, any>() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { channel, removeChannel } }));

import { useTypingIndicator } from "./useTypingIndicator";

function makeChannel(name: string) {
  const record: any = { name, state: {} };
  record.on = vi.fn((_kind: string, _config: any, handler: () => void) => { record.sync = handler; return record; });
  record.subscribe = vi.fn((handler: (status: string) => void) => { record.status = handler; return record; });
  record.track = vi.fn().mockResolvedValue(undefined);
  record.presenceState = vi.fn(() => record.state);
  channels.set(name, record);
  return record;
}

describe("useTypingIndicator", () => {
  beforeEach(() => { vi.clearAllMocks(); channels.clear(); channel.mockImplementation(makeChannel); });

  it("does not subscribe without both user and channel identity", () => {
    renderHook(() => useTypingIndicator("", "user-1", "Alex"));
    renderHook(() => useTypingIndicator("team-1", undefined, "Alex"));
    expect(channel).not.toHaveBeenCalled();
  });

  it("tracks an initial non-typing presence after subscription", async () => {
    renderHook(() => useTypingIndicator("team-1", "user-1", "Alex"));
    const record = channels.get("typing:team-1");
    await act(async () => record.status("SUBSCRIBED"));
    expect(record.track).toHaveBeenCalledWith({ userId: "user-1", userName: "Alex", isTyping: false });
  });

  it("shows other typing users, excludes self, and supplies a safe fallback name", () => {
    const { result } = renderHook(() => useTypingIndicator("team-1", "user-1", "Alex"));
    const record = channels.get("typing:team-1");
    record.state = {
      a: [{ userId: "user-1", userName: "Alex", isTyping: true }],
      b: [{ userId: "user-2", userName: "Blair", isTyping: true }],
      c: [{ userId: "user-3", isTyping: true }, { userId: "user-4", userName: "Casey", isTyping: false }],
    };
    act(() => record.sync());
    expect(result.current.typingUsers).toEqual([{ id: "user-2", name: "Blair" }, { id: "user-3", name: "Someone" }]);
  });

  it("deduplicates typing state and automatically stops after three seconds", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypingIndicator("team-1", "user-1", "Alex"));
    const record = channels.get("typing:team-1");
    await act(async () => { await result.current.startTyping(); await result.current.startTyping(); });
    expect(record.track).toHaveBeenCalledTimes(1);
    expect(record.track).toHaveBeenLastCalledWith({ userId: "user-1", userName: "Alex", isTyping: true });
    act(() => vi.advanceTimersByTime(3000));
    expect(record.track).toHaveBeenLastCalledWith({ userId: "user-1", userName: "Alex", isTyping: false });
    vi.useRealTimers();
  });

  it("cleans up the old channel when switching chats and on unmount", () => {
    const { rerender, unmount } = renderHook(({ name }) => useTypingIndicator(name, "user-1", "Alex"), { initialProps: { name: "team-1" } });
    const first = channels.get("typing:team-1");
    rerender({ name: "team-2" });
    const second = channels.get("typing:team-2");
    expect(removeChannel).toHaveBeenCalledWith(first);
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(second);
  });
});
