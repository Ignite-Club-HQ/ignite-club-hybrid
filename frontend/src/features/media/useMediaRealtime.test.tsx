import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { channel, removeChannel, channels } = vi.hoisted(() => ({
  channel: vi.fn(),
  removeChannel: vi.fn(),
  channels: new Map<string, any>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel, removeChannel },
}));

import { useMediaRealtime } from "./useMediaRealtime";

function makeChannel(name: string) {
  const record: any = { name, handlers: new Map<string, (payload: any) => void>() };
  record.on = vi.fn((_type: string, config: any, handler: (payload: any) => void) => {
    record.handlers.set(config.table, handler);
    return record;
  });
  record.subscribe = vi.fn(() => record);
  channels.set(name, record);
  return record;
}

function setup(userId: string | undefined, photoIds: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(({ id, ids }) => useMediaRealtime(id, ids), {
    wrapper,
    initialProps: { id: userId, ids: photoIds },
  }), invalidate };
}

describe("useMediaRealtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channels.clear();
    channel.mockImplementation(makeChannel);
    delete (window as any).Capacitor;
  });

  it("does not subscribe without an authenticated user", () => {
    setup(undefined, ["photo-a"]);
    expect(channel).not.toHaveBeenCalled();
  });

  it("subscribes before callbacks can run and invalidates the user's feed on insert", () => {
    const { invalidate } = setup("user-a", ["photo-a"]);
    const feed = channels.get("media-feed-user-a");
    expect(feed.on.mock.invocationCallOrder[0]).toBeLessThan(feed.subscribe.mock.invocationCallOrder[0]);
    act(() => feed.handlers.get("photos")({ new: { id: "photo-new" } }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["photos", "user-a"] });
  });

  it("invalidates engagement only for a currently loaded photo", () => {
    const { invalidate } = setup("user-a", ["photo-a"]);
    const engagement = channels.get("media-comments-user-a");
    act(() => engagement.handlers.get("photo_comments")({ new: { photo_id: "outside" } }));
    act(() => engagement.handlers.get("photo_reactions")({ old: { photo_id: "photo-a" } }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["photo-reactions", "user-a"] });
  });

  it("does not churn channels when an equivalent photo-id array is recreated", () => {
    const { rerender } = setup("user-a", ["photo-a", "photo-b"]);
    const initialCalls = channel.mock.calls.length;
    rerender({ id: "user-a", ids: ["photo-a", "photo-b"] });
    expect(channel).toHaveBeenCalledTimes(initialCalls);
    expect(removeChannel).not.toHaveBeenCalled();
  });

  it("replaces scoped channels and cleans everything up on unmount", () => {
    const { rerender, unmount } = setup("user-a", ["photo-a"]);
    const firstFeed = channels.get("media-feed-user-a");
    const firstEngagement = channels.get("media-comments-user-a");
    rerender({ id: "user-b", ids: ["photo-b"] });
    expect(removeChannel).toHaveBeenCalledWith(firstFeed);
    expect(removeChannel).toHaveBeenCalledWith(firstEngagement);
    const secondFeed = channels.get("media-feed-user-b");
    const secondEngagement = channels.get("media-comments-user-b");
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(secondFeed);
    expect(removeChannel).toHaveBeenCalledWith(secondEngagement);
  });

  it("refreshes engagement on browser visibility but leaves native resume to its adapter", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const browser = setup("user-a", ["photo-a"]);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(browser.invalidate).toHaveBeenCalledWith({ queryKey: ["photo-comments", "user-a"] });
    expect(browser.invalidate).toHaveBeenCalledWith({ queryKey: ["photo-reactions", "user-a"] });
    browser.unmount();

    (window as any).Capacitor = { isNativePlatform: () => true };
    const native = setup("user-a", ["photo-a"]);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(native.invalidate).not.toHaveBeenCalled();
    native.unmount();
    visibility.mockRestore();
  });
});
