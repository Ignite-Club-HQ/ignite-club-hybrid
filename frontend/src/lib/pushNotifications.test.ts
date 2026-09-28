import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, tableData, dbError } = vi.hoisted(() => ({
  from: vi.fn(),
  tableData: { current: null as unknown },
  dbError: { current: null as unknown },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import {
  checkPushSubscription,
  clearStalePushLocks,
  forceUnlockPushSubscription,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
} from "./pushNotifications";

function query() {
  const chain: Record<string, any> = {};
  for (const method of ["select", "delete", "eq"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: tableData.current, error: dbError.current }));
  chain.then = vi.fn((resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve({ data: tableData.current, error: dbError.current })),
  );
  return chain;
}

function serviceWorkerWithSubscription(subscription: unknown) {
  const getSubscription = vi.fn().mockResolvedValue(subscription);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription } }) },
  });
  vi.stubGlobal("PushManager", class PushManager {});
  return getSubscription;
}

describe("push notification core safety boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    tableData.current = null;
    dbError.current = null;
    from.mockImplementation(() => query());
    Object.defineProperty(window, "Capacitor", { configurable: true, value: undefined });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("never creates a web-push row outside the native Capacitor app", async () => {
    await expect(subscribeToPushNotifications("user-1")).resolves.toEqual({
      success: false,
      error: "Push notifications are only available in the Ignite mobile app.",
    });
    expect(from).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("push_subscription_in_progress")).toBeNull();
  });

  it("fails closed if native-platform detection itself throws", async () => {
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { isNativePlatform: () => { throw new Error("bridge unavailable"); } },
    });
    await expect(subscribeToPushNotifications("user-1")).resolves.toMatchObject({ success: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("force-clears a subscription mutex", () => {
    sessionStorage.setItem("push_subscription_in_progress", JSON.stringify({ timestamp: Date.now(), runId: "run-1" }));
    forceUnlockPushSubscription();
    expect(sessionStorage.getItem("push_subscription_in_progress")).toBeNull();
  });

  it("clears an expired mutex but preserves a recent active operation", () => {
    const now = Date.now();
    sessionStorage.setItem("push_subscription_in_progress", JSON.stringify({ timestamp: now - 60_000, runId: "old" }));
    clearStalePushLocks();
    expect(sessionStorage.getItem("push_subscription_in_progress")).toBeNull();

    sessionStorage.setItem("push_subscription_in_progress", JSON.stringify({ timestamp: now, runId: "current" }));
    clearStalePushLocks();
    expect(sessionStorage.getItem("push_subscription_in_progress")).not.toBeNull();
  });

  it("unsubscribes both the user's database row and current browser endpoint", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    serviceWorkerWithSubscription({ unsubscribe });

    await expect(unsubscribeFromPushNotifications("user-1")).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    const dbQuery = from.mock.results[0].value;
    expect(dbQuery.delete).toHaveBeenCalled();
    expect(dbQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("still completes unsubscribe when no browser subscription exists", async () => {
    serviceWorkerWithSubscription(null);
    await expect(unsubscribeFromPushNotifications("user-1")).resolves.toBe(true);
  });

  it("reports no active push when browser capabilities or subscription are absent", async () => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    await expect(checkPushSubscription("user-1")).resolves.toBe(false);

    serviceWorkerWithSubscription(null);
    await expect(checkPushSubscription("user-1")).resolves.toBe(false);
  });

  it("requires the current endpoint to exist for the same user in the database", async () => {
    serviceWorkerWithSubscription({ endpoint: "https://push.example/device-a" });
    tableData.current = { id: "subscription-1" };
    await expect(checkPushSubscription("user-1")).resolves.toBe(true);
    const dbQuery = from.mock.results[0].value;
    expect(dbQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(dbQuery.eq).toHaveBeenCalledWith("endpoint", "https://push.example/device-a");

    tableData.current = null;
    await expect(checkPushSubscription("user-1")).resolves.toBe(false);
  });
});
