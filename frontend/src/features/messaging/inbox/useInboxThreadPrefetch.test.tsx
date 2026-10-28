import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInboxThreadPrefetch } from "./useInboxThreadPrefetch";

const routing = vi.hoisted(() => ({ icp: false }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => routing.icp }));

describe("inbox speculative read isolation", () => {
  let queryClient: QueryClient;
  let idle: (() => void) | undefined;
  const from = vi.fn();
  const native = () => false;
  const mount = () => renderHook(() => useInboxThreadPrefetch({
    enabled: true, queryClient, client: { from }, teamIds: [],
    clubIds: ["giddy-goat"], groupIds: [], cap: 1,
    messagesPerPage: 15, isNativeRuntime: native,
  }));

  beforeEach(() => {
    routing.icp = false;
    idle = undefined;
    from.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: () => void) => { idle = callback; return 1; }));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    from.mockImplementation(() => ({ select: () => ({
      eq: () => ({ order: () => ({ limit: async () => ({ data: [{ id: "club-message" }], error: null }) }) }),
      order: () => ({ limit: async () => ({ data: [{ id: "broadcast-message" }], error: null }) }),
    }) }));
  });

  afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

  it("never schedules old message tables for an Internet Identity account, even while the inbox stays mounted", () => {
    routing.icp = true;
    const { unmount } = mount();
    expect(idle).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    unmount();
  });

  it("retires an idle prefetch if the provider changes before it runs", async () => {
    const { unmount } = mount();
    routing.icp = true;
    await act(async () => { idle?.(); });
    expect(from).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    unmount();
  });

  it("still preloads authorized broadcast and club rows for email sign-in", async () => {
    const { unmount } = mount();
    await act(async () => { idle?.(); });
    expect(from.mock.calls.map(([table]) => table)).toEqual(["broadcast_messages", "club_messages"]);
    expect(queryClient.getQueryData(["club-messages", "giddy-goat"])).toEqual({ messages: [{ id: "club-message" }], hasOlderMessages: false });
    unmount();
  });

  it("refuses a queued query after switching to ICP instead of publishing an empty chat", async () => {
    const jobs: Array<{ queryFn: () => Promise<unknown> }> = [];
    vi.spyOn(queryClient, "prefetchQuery").mockImplementation((options: any) => { jobs.push(options); return Promise.resolve(); });
    const { unmount } = mount();
    await act(async () => { idle?.(); });
    routing.icp = true;
    expect(jobs).toHaveLength(2);
    for (const job of jobs) await expect(job.queryFn()).rejects.toThrow("Inbox prefetch retired");
    expect(from).not.toHaveBeenCalled();
    unmount();
  });
});