import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  logPush: vi.fn(),
  markSubscriptionValidated: vi.fn(),
  markSubscriptionFailed: vi.fn(),
  clearSubscriptionFreshness: vi.fn(),
  storePermissionState: vi.fn(),
  permissionWasRevoked: vi.fn(() => false),
  getOfflineQueue: vi.fn(() => [] as any[]),
  updateQueueOperation: vi.fn(),
  removeFromOfflineQueue: vi.fn(),
  tableData: [] as any[],
  fetchError: null as any,
  mutationError: null as any,
  lastInValues: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("./pushReliability", () => ({
  logPush: mocks.logPush,
  generateCorrelationId: () => "correlation-1",
  markSubscriptionValidated: mocks.markSubscriptionValidated,
  markSubscriptionFailed: mocks.markSubscriptionFailed,
  getPlatformInfo: () => ({ platform: "desktop-chrome", supportsNativePush: true, requiresPWA: false, reliabilityRating: 5 }),
  withExponentialBackoff: vi.fn(),
  addToOfflineQueue: vi.fn(),
  removeFromOfflineQueue: mocks.removeFromOfflineQueue,
  getOfflineQueue: mocks.getOfflineQueue,
  updateQueueOperation: mocks.updateQueueOperation,
  storePermissionState: mocks.storePermissionState,
  permissionWasRevoked: mocks.permissionWasRevoked,
  clearSubscriptionFreshness: mocks.clearSubscriptionFreshness,
}));

import {
  cleanupStaleSubscriptions,
  handlePermissionRevoked,
  processOfflineQueue,
  verifySubscriptionHealth,
} from "./pushSubscriptionSync";

function supabaseQuery() {
  let mutation = false;
  const query: Record<string, any> = {};
  query.select = vi.fn(() => query);
  query.delete = vi.fn(() => { mutation = true; return query; });
  query.eq = vi.fn(() => query);
  query.in = vi.fn((_column: string, values: string[]) => {
    mocks.lastInValues = values;
    return query;
  });
  query.maybeSingle = vi.fn(async () => ({
    data: mocks.tableData[0] ?? null,
    error: mocks.fetchError,
  }));
  query.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(resolve(
    mutation
      ? { data: null, error: mocks.mutationError }
      : { data: mocks.tableData, error: mocks.fetchError },
  )));
  return query;
}

function installBrowserSubscription(endpoint: string | null, failure?: Error) {
  const getSubscription = failure
    ? vi.fn().mockRejectedValue(failure)
    : vi.fn().mockResolvedValue(endpoint ? { endpoint } : null);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription } }) },
  });
  vi.stubGlobal("PushManager", class PushManager {});
  return getSubscription;
}

describe("push subscription browser/database consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tableData = [];
    mocks.fetchError = null;
    mocks.mutationError = null;
    mocks.lastInValues = [];
    mocks.permissionWasRevoked.mockReturnValue(false);
    mocks.getOfflineQueue.mockReturnValue([]);
    mocks.from.mockImplementation(() => supabaseQuery());
    installBrowserSubscription(null);
  });

  it("keeps the database row when it matches the browser endpoint", async () => {
    installBrowserSubscription("https://push.example/device-a");
    mocks.tableData = [{ id: "sub-a", endpoint: "https://push.example/device-a" }];

    await expect(cleanupStaleSubscriptions("user-1")).resolves.toEqual({ removed: 0 });
    expect(mocks.lastInValues).toEqual([]);
  });

  it("deletes only endpoint rows that do not match the current browser", async () => {
    installBrowserSubscription("https://push.example/device-a");
    mocks.tableData = [
      { id: "sub-a", endpoint: "https://push.example/device-a" },
      { id: "sub-stale", endpoint: "https://push.example/expired" },
    ];

    await expect(cleanupStaleSubscriptions("user-1")).resolves.toEqual({ removed: 1 });
    expect(mocks.lastInValues).toEqual(["sub-stale"]);
  });

  it("reports a database read failure without attempting deletion", async () => {
    mocks.fetchError = { message: "RLS denied" };
    await expect(cleanupStaleSubscriptions("user-1")).resolves.toEqual({ removed: 0, error: "RLS denied" });
    expect(mocks.lastInValues).toEqual([]);
  });

  it("reports a cleanup deletion failure without claiming rows were removed", async () => {
    installBrowserSubscription("https://push.example/current");
    mocks.tableData = [{ id: "sub-stale", endpoint: "https://push.example/old" }];
    mocks.mutationError = { message: "delete rejected" };

    await expect(cleanupStaleSubscriptions("user-1")).resolves.toEqual({ removed: 0, error: "delete rejected" });
  });

  it("recognises a healthy matching browser and database subscription", async () => {
    installBrowserSubscription("https://push.example/device-a");
    mocks.tableData = [{ endpoint: "https://push.example/device-a" }];

    await expect(verifySubscriptionHealth("user-1")).resolves.toEqual({
      healthy: true,
      browserHasSubscription: true,
      dbHasSubscription: true,
      endpointsMatch: true,
      reason: undefined,
    });
    expect(mocks.markSubscriptionValidated).toHaveBeenCalledWith("https://push.example/device-a");
    expect(mocks.markSubscriptionFailed).not.toHaveBeenCalled();
  });

  it.each([
    [null, { endpoint: "db-endpoint" }, "No browser subscription"],
    ["browser-endpoint", null, "No database subscription"],
    ["browser-endpoint", { endpoint: "other-endpoint" }, "Endpoint mismatch"],
  ])("marks inconsistent endpoint state unhealthy", async (browserEndpoint, dbRow, reason) => {
    installBrowserSubscription(browserEndpoint);
    mocks.tableData = dbRow ? [dbRow] : [];
    const result = await verifySubscriptionHealth("user-1");
    expect(result).toMatchObject({ healthy: false, reason });
    expect(mocks.markSubscriptionFailed).toHaveBeenCalledOnce();
  });

  it("removes database subscriptions and local freshness after permission revocation", async () => {
    await handlePermissionRevoked("user-1");
    const query = mocks.from.mock.results[0].value;
    expect(query.delete).toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(mocks.clearSubscriptionFreshness).toHaveBeenCalledOnce();
    expect(mocks.storePermissionState).toHaveBeenCalledWith("denied");
  });

  it("short-circuits health verification and cleans up when permission was revoked", async () => {
    mocks.permissionWasRevoked.mockReturnValue(true);
    const result = await verifySubscriptionHealth("user-1");
    expect(result).toMatchObject({ healthy: false, reason: "Permission was revoked" });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.markSubscriptionValidated).not.toHaveBeenCalled();
  });

  it("processes successful subscribe and unsubscribe queue operations", async () => {
    mocks.getOfflineQueue.mockReturnValue([
      { id: "subscribe-1", type: "subscribe", userId: "user-1", attempts: 0 },
      { id: "unsubscribe-1", type: "unsubscribe", userId: "user-2", attempts: 1 },
    ]);
    const subscribe = vi.fn().mockResolvedValue({ success: true });

    await expect(processOfflineQueue(subscribe)).resolves.toEqual({ processed: 2, failed: 0 });
    expect(subscribe).toHaveBeenCalledWith("user-1");
    expect(mocks.removeFromOfflineQueue).toHaveBeenCalledWith("subscribe-1");
    expect(mocks.removeFromOfflineQueue).toHaveBeenCalledWith("unsubscribe-1");
  });

  it("removes operations at the attempt limit without invoking subscription", async () => {
    mocks.getOfflineQueue.mockReturnValue([
      { id: "exhausted", type: "subscribe", userId: "user-1", attempts: 3 },
    ]);
    const subscribe = vi.fn();
    await expect(processOfflineQueue(subscribe)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(subscribe).not.toHaveBeenCalled();
    expect(mocks.removeFromOfflineQueue).toHaveBeenCalledWith("exhausted");
  });

  it("retains a failed operation with updated attempt and error metadata", async () => {
    mocks.getOfflineQueue.mockReturnValue([
      { id: "retry-me", type: "revalidate", userId: "user-1", attempts: 1 },
    ]);
    const subscribe = vi.fn().mockResolvedValue({ success: false, error: "network unavailable" });
    await expect(processOfflineQueue(subscribe)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(mocks.updateQueueOperation).toHaveBeenCalledWith("retry-me", expect.objectContaining({ attempts: 2 }));
    expect(mocks.updateQueueOperation).toHaveBeenCalledWith("retry-me", { error: "network unavailable" });
    expect(mocks.removeFromOfflineQueue).not.toHaveBeenCalled();
  });
});
