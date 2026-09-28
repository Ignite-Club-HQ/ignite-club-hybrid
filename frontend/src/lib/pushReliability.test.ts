import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addToOfflineQueue,
  clearOfflineQueue,
  getOfflineQueue,
  getSubscriptionFreshness,
  markSubscriptionFailed,
  markSubscriptionValidated,
  needsRevalidation,
  permissionWasRevoked,
  storePermissionState,
  withExponentialBackoff,
} from "./pushReliability";

describe("push reliability primitives", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("returns immediately after a successful first attempt", async () => {
    const operation = vi.fn().mockResolvedValue("subscribed");
    await expect(withExponentialBackoff(operation, { baseDelayMs: 100 })).resolves.toBe("subscribed");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("retries transient failures with capped exponential delays", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("network one"))
      .mockRejectedValueOnce(new Error("network two"))
      .mockResolvedValue("ok");
    const result = withExponentialBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 150,
      backoffMultiplier: 2,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(149);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("stops retrying when the error is not retryable", async () => {
    const operation = vi.fn().mockRejectedValue(new DOMException("permission denied", "NotAllowedError"));
    const promise = withExponentialBackoff(operation, {}, () => false);
    await expect(promise).rejects.toThrow("permission denied");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("throws the final error after the configured attempt limit", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("still offline"));
    const promise = withExponentialBackoff(operation, { maxAttempts: 2, baseDelayMs: 50 });
    const rejection = expect(promise).rejects.toThrow("still offline");
    await vi.runAllTimersAsync();
    await rejection;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("deduplicates queued operations by type and user", () => {
    addToOfflineQueue({ type: "subscribe", userId: "user-1" });
    addToOfflineQueue({ type: "subscribe", userId: "user-1" });
    addToOfflineQueue({ type: "revalidate", userId: "user-1" });
    addToOfflineQueue({ type: "subscribe", userId: "user-2" });

    expect(getOfflineQueue().map(({ type, userId }) => ({ type, userId }))).toEqual([
      { type: "subscribe", userId: "user-1" },
      { type: "revalidate", userId: "user-1" },
      { type: "subscribe", userId: "user-2" },
    ]);
  });

  it("discards offline operations older than 24 hours", () => {
    localStorage.setItem("push_offline_queue", JSON.stringify([
      { id: "old", type: "subscribe", userId: "u1", timestamp: Date.now() - 24 * 60 * 60 * 1000, attempts: 0 },
      { id: "fresh", type: "subscribe", userId: "u2", timestamp: Date.now() - 1000, attempts: 0 },
    ]));
    expect(getOfflineQueue().map((entry) => entry.id)).toEqual(["fresh"]);
    clearOfflineQueue();
    expect(getOfflineQueue()).toEqual([]);
  });

  it("marks successful validation fresh and clears prior failures", () => {
    markSubscriptionFailed();
    markSubscriptionFailed();
    markSubscriptionValidated("https://push.example/device-a");

    expect(getSubscriptionFreshness()).toMatchObject({
      lastValidated: Date.now(),
      consecutiveFailures: 0,
      endpoint: "https://push.example/device-a",
    });
    expect(needsRevalidation()).toBe(false);
  });

  it("requires revalidation after two hours or after any recorded failure", () => {
    markSubscriptionValidated("endpoint");
    vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000 + 1));
    expect(needsRevalidation()).toBe(true);

    markSubscriptionValidated("endpoint");
    markSubscriptionFailed();
    expect(needsRevalidation()).toBe(true);
  });

  it("recognises an explicit granted-to-denied permission transition", () => {
    storePermissionState("granted");
    vi.stubGlobal("Notification", { permission: "denied" });
    expect(permissionWasRevoked()).toBe(true);

    storePermissionState("default");
    expect(permissionWasRevoked()).toBe(false);
  });
});
