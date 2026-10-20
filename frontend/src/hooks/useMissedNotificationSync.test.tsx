import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { from, queryResult, showNotification, listInbox } = vi.hoisted(() => ({
  from: vi.fn(),
  queryResult: { data: [] as any[], error: null as any },
  showNotification: vi.fn(),
  listInbox: vi.fn(),
}));
const icpMode = vi.hoisted(() => process.env.IGNITE_TEST_BACKEND_MODE === "icp");

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from },
}));
vi.mock("@/live/authBackendMode", () => ({
  resolveAuthBackend: () => (icpMode ? "icp" : "supabase"),
}));

vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, h: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) => icpMode ? h.icp({}) : h.supabase() }));
vi.mock("@/live/features/notifications", () => ({ listLiveInbox: (...args: unknown[]) => listInbox(...args) }));

import { useMissedNotificationSync } from "./useMissedNotificationSync";

function notificationQuery() {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.gte = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  Object.defineProperty(query, "then", {
    value: (resolve: any) => Promise.resolve(queryResult).then(resolve),
  });
  return query;
}

const notification = (id: string, minutesAgo = 1) => ({
  id,
  message: `Message ${id}`,
  type: "event_update",
  created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});

async function manuallySync(result: { current: { syncMissedNotifications: () => Promise<void> } }) {
  await act(async () => {
    const sync = result.current.syncMissedNotifications();
    // Flush the hook's per-notification spacing without also triggering its
    // independent three-second mount sync.
    await vi.advanceTimersByTimeAsync(2_000);
    await sync;
  });
}

describe.runIf(!icpMode)("useMissedNotificationSync recovery and deduplication", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
    localStorage.clear();
    vi.clearAllMocks();
    queryResult.data = [];
    queryResult.error = null;
    from.mockImplementation(() => notificationQuery());
    showNotification.mockResolvedValue(undefined);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "granted" },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({ showNotification }) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when there is no authenticated user", async () => {
    const { result } = renderHook(() => useMissedNotificationSync(undefined));

    await manuallySync(result);

    expect(from).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("fetches only the user's recent unread notifications in newest-first order", async () => {
    const query = notificationQuery();
    from.mockReturnValue(query);
    const { result } = renderHook(() => useMissedNotificationSync("user-1"));

    await manuallySync(result);

    expect(from).toHaveBeenCalledWith("notifications");
    expect(query.select).toHaveBeenCalledWith("id, message, type, created_at");
    expect(query.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "is_read", false);
    expect(query.gte).toHaveBeenCalledWith("created_at", "2026-07-19T10:00:00.000Z");
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(10);
  });

  it("shows each missed notification once and persists its deduplication marker", async () => {
    queryResult.data = [notification("notification-1")];
    const first = renderHook(() => useMissedNotificationSync("user-1"));

    await manuallySync(first.result);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(
      "Ignite",
      expect.objectContaining({
        body: "Message notification-1",
        tag: "missed-notification-1",
        data: expect.objectContaining({ notificationId: "notification-1", isMissed: true }),
      }),
    );
    expect(JSON.parse(localStorage.getItem("notifications-last-shown")!)).toEqual({
      "notification-1": new Date("2026-07-19T12:00:00Z").getTime(),
    });
    first.unmount();

    vi.clearAllMocks();
    from.mockImplementation(() => notificationQuery());
    const second = renderHook(() => useMissedNotificationSync("user-1"));
    await manuallySync(second.result);

    expect(showNotification).not.toHaveBeenCalled();
  });

  it("expires deduplication markers after 24 hours", async () => {
    localStorage.setItem(
      "notifications-last-shown",
      JSON.stringify({ "notification-1": Date.now() - 24 * 60 * 60 * 1000 - 1 }),
    );
    queryResult.data = [notification("notification-1")];
    const { result } = renderHook(() => useMissedNotificationSync("user-1"));

    await manuallySync(result);

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("notifications-last-shown")!)).toEqual({
      "notification-1": new Date("2026-07-19T12:00:00Z").getTime(),
    });
  });

  it("limits individual alerts to three and provides a summary for the remainder", async () => {
    queryResult.data = [1, 2, 3, 4, 5].map(id => notification(`notification-${id}`, id));
    const { result } = renderHook(() => useMissedNotificationSync("user-1"));

    await manuallySync(result);

    expect(showNotification).toHaveBeenCalledTimes(4);
    expect(showNotification.mock.calls.slice(0, 3).map(call => call[1].tag)).toEqual([
      "missed-notification-1",
      "missed-notification-2",
      "missed-notification-3",
    ]);
    expect(showNotification).toHaveBeenLastCalledWith(
      "Ignite",
      expect.objectContaining({ body: "You have 2 more notifications", tag: "missed-summary" }),
    );
  });

  it("does not record a failed lookup as a successful sync and permits an immediate retry", async () => {
    queryResult.error = { message: "notifications unavailable" };
    const { result } = renderHook(() => useMissedNotificationSync("user-1"));

    await manuallySync(result);
    expect(localStorage.getItem("notifications-last-sync")).toBeNull();

    queryResult.error = null;
    queryResult.data = [notification("notification-1")];
    await manuallySync(result);

    expect(from).toHaveBeenCalledTimes(2);
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate a notification whose browser delivery failed", async () => {
    queryResult.data = [notification("notification-1")];
    showNotification.mockRejectedValueOnce(new Error("service worker unavailable"));
    const { result } = renderHook(() => useMissedNotificationSync("user-1"));

    await manuallySync(result);
    expect(localStorage.getItem("notifications-last-shown")).toBeNull();

    showNotification.mockResolvedValue(undefined);
    await manuallySync(result);

    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem("notifications-last-shown")!)).toHaveProperty(
      "notification-1",
    );
  });
});

describe.runIf(icpMode)("useMissedNotificationSync ICP boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
    localStorage.clear();
    vi.clearAllMocks();
    listInbox.mockReset().mockResolvedValue([]);
    showNotification.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted" } });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({ showNotification }) },
    });
  });

  afterEach(() => vi.useRealTimers());

  it("does not query Supabase or replay missed push notifications", async () => {
    const { result } = renderHook(() => useMissedNotificationSync("principal-1"));
    await manuallySync(result);
    expect(from).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("filters recent unread canister inbox rows and deduplicates local delivery", async () => {
    listInbox.mockResolvedValue([
      { id: "newest", kind: "event_update", body: "Newest", read: false, created_at_ms: BigInt(Date.now() - 60_000) },
      { id: "already-read", kind: "event_update", body: "Read", read: true, created_at_ms: BigInt(Date.now() - 30_000) },
      { id: "too-old", kind: "event_update", body: "Old", read: false, created_at_ms: BigInt(Date.now() - 3 * 60 * 60_000) },
      { id: "older", kind: "event_update", body: "Older", read: false, created_at_ms: BigInt(Date.now() - 2 * 60_000) },
    ]);
    const syncStartedAt = Date.now();
    const { result } = renderHook(() => useMissedNotificationSync("principal-1"));

    await manuallySync(result);

    expect(listInbox).toHaveBeenCalledWith({}, "principal-1", null, 100);
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification.mock.calls.map((call) => call[1].body)).toEqual(["Newest", "Older"]);
    const shown = JSON.parse(localStorage.getItem("notifications-last-shown")!);
    expect(Object.keys(shown).sort()).toEqual(["newest", "older"]);
    expect(Object.values(shown).every((timestamp: any) => timestamp >= syncStartedAt && timestamp <= syncStartedAt + 2_000)).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it("does not mark a canister inbox failure as synced and permits retry", async () => {
    listInbox.mockRejectedValueOnce(new Error("inbox unavailable"));
    const { result } = renderHook(() => useMissedNotificationSync("principal-1"));

    await manuallySync(result);
    expect(localStorage.getItem("notifications-last-sync")).toBeNull();

    listInbox.mockResolvedValueOnce([]);
    await manuallySync(result);
    expect(listInbox).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("notifications-last-sync")).not.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
