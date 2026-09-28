/**
 * Sanity/regression tests for usePushSubscriptionHealth.
 *
 * The nudge defect fix (fail-open on subscription lookup errors) lives in
 * useNotificationNudge, but the spec runs both test files together to prove
 * the health hook's behaviour is unaffected. These tests verify the hook
 * initialises safely with/without a user and does not contact any real
 * push/database service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ---- mocks: prevent any real network/service worker access ------------
vi.mock("@/lib/pushNotifications", () => ({
  subscribeToPushNotifications: vi.fn(async () => ({ success: true })),
  checkPushSubscription: vi.fn(async () => ({ exists: false })),
  resetPushNotifications: vi.fn(async () => undefined),
}));

vi.mock("@/lib/pushReliability", () => ({
  logPush: vi.fn(),
  generateCorrelationId: () => "test-corr-id",
  needsRevalidation: () => false,
  needsIOSProactiveRenewal: () => false,
  markSubscriptionValidated: vi.fn(),
  markSubscriptionRenewed: vi.fn(),
  checkServiceWorkerUpdate: vi.fn(async () => false),
  activateWaitingServiceWorker: vi.fn(async () => undefined),
  permissionWasRevoked: () => false,
  getPlatformInfo: () => ({ platform: "web", reliabilityRating: "high" }),
}));

vi.mock("@/lib/pushSubscriptionSync", () => ({
  verifySubscriptionHealth: vi.fn(async () => ({ healthy: true })),
  cleanupStaleSubscriptions: vi.fn(async () => undefined),
  handlePermissionRevoked: vi.fn(async () => undefined),
  processOfflineQueue: vi.fn(async () => undefined),
  resilientSubscribe: vi.fn(async () => ({ success: true, queued: false })),
}));

import { usePushSubscriptionHealth } from "./usePushSubscriptionHealth";

beforeEach(() => {
  // Provide a minimal serviceWorker shim so the hook's useEffect body runs.
  if (!("serviceWorker" in navigator)) {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
      },
    });
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePushSubscriptionHealth", () => {
  it("returns validateAndResubscribe and validateSubscription callables", () => {
    const { result } = renderHook(() => usePushSubscriptionHealth("user-a"));
    expect(typeof result.current.validateAndResubscribe).toBe("function");
    expect(typeof result.current.validateSubscription).toBe("function");
  });

  it("is a no-op without a user (no throws, still returns callables)", () => {
    const { result } = renderHook(() => usePushSubscriptionHealth(undefined));
    expect(typeof result.current.validateAndResubscribe).toBe("function");
    expect(typeof result.current.validateSubscription).toBe("function");
  });

  it("validateAndResubscribe returns false without a user", async () => {
    const { result } = renderHook(() => usePushSubscriptionHealth(undefined));
    await expect(result.current.validateAndResubscribe()).resolves.toBe(false);
  });

  it("unmount cleans up without errors", () => {
    const { unmount } = renderHook(() => usePushSubscriptionHealth("user-a"));
    expect(() => unmount()).not.toThrow();
  });
});
