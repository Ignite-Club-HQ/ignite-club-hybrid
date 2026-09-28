/**
 * Regression: Android can restore connectivity while the app is backgrounded
 * and never emit `networkStatusChange`. On resume, `Network.getStatus()`
 * reports connected — that is a genuine offline→online transition and must
 * trigger exactly one controlled active-query recovery.
 *
 * Conversely, an ordinary online→online resume must NOT blanket-refetch
 * active queries (that regression saturated the WebView connection pool and
 * froze the UI).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, onlineManager } from "@tanstack/react-query";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));

type NetHandler = (status: { connected: boolean }) => void;
const networkListeners: NetHandler[] = [];
let currentConnected = true;

vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: async () => ({ connected: currentConnected }),
    addListener: (_event: string, handler: NetHandler) => {
      networkListeners.push(handler);
      return { remove: () => {} };
    },
  },
}));

type AppHandler = (state: { isActive: boolean }) => void;
const appListeners: AppHandler[] = [];

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (_event: string, handler: AppHandler) => {
      appListeners.push(handler);
      return Promise.resolve({ remove: () => {} });
    },
  },
}));

import { setupReactQueryNativeAdapter } from "./reactQueryNativeAdapter";

const ACTIVE_KEYS = [["inbox"], ["schedule"], ["media"]];

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
};

const seedActive = (qc: QueryClient) => {
  // A query is "active" only when it has observers; emulate that by
  // subscribing an observer-like entry through the cache.
  return ACTIVE_KEYS.map((queryKey) => {
    qc.setQueryData(queryKey, { ok: true });
    const observer = qc
      .getQueryCache()
      .find({ queryKey, exact: true })!;
    // Fake an observer so findAll({ type: 'active' }) picks it up.
    (observer as unknown as { observers: unknown[] }).observers = [{ options: { enabled: true } }];
    return observer;
  });
};

const countActiveRefetches = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => {
    const key = (c[0] as { queryKey?: unknown[] })?.queryKey?.[0];
    return typeof key === "string" && ["inbox", "schedule", "media"].includes(key);
  }).length;

describe("reactQueryNativeAdapter — resume vs reconnect", () => {
  let qc: QueryClient;

  beforeEach(() => {
    networkListeners.length = 0;
    appListeners.length = 0;
    currentConnected = true;
    onlineManager.setOnline(true);
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    qc.clear();
    vi.restoreAllMocks();
  });

  const boot = async () => {
    setupReactQueryNativeAdapter(qc);
    await settle();
  };

  it("does not refetch active queries on an ordinary online resume", async () => {
    seedActive(qc);
    await boot();
    const spy = vi.spyOn(qc, "refetchQueries");

    appListeners.forEach((h) => h({ isActive: false }));
    appListeners.forEach((h) => h({ isActive: true }));
    await settle();

    expect(countActiveRefetches(spy)).toBe(0);
  });

  it("refetches active Inbox, Schedule and Media queries after a genuine offline→online resume", async () => {
    seedActive(qc);
    await boot();
    const spy = vi.spyOn(qc, "refetchQueries");

    // Android reports offline, app backgrounds, connectivity silently returns.
    currentConnected = false;
    networkListeners.forEach((h) => h({ connected: false }));
    expect(onlineManager.isOnline()).toBe(false);

    appListeners.forEach((h) => h({ isActive: false }));
    currentConnected = true; // no networkStatusChange emitted
    appListeners.forEach((h) => h({ isActive: true }));
    await settle();

    expect(onlineManager.isOnline()).toBe(true);
    expect(countActiveRefetches(spy)).toBe(ACTIVE_KEYS.length);
  });

  it("does not recover twice when a delayed networkStatusChange follows the resume", async () => {
    seedActive(qc);
    await boot();
    const spy = vi.spyOn(qc, "refetchQueries");

    currentConnected = false;
    networkListeners.forEach((h) => h({ connected: false }));
    appListeners.forEach((h) => h({ isActive: false }));
    currentConnected = true;
    appListeners.forEach((h) => h({ isActive: true }));
    await settle();

    // Late duplicate event from the OS.
    networkListeners.forEach((h) => h({ connected: true }));
    await settle();

    expect(countActiveRefetches(spy)).toBe(ACTIVE_KEYS.length);
  });

  it("does not refetch active queries when resuming while still offline", async () => {
    // Keep the connectivity probe genuinely failing so the offline state holds.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    seedActive(qc);
    await boot();
    const spy = vi.spyOn(qc, "refetchQueries");

    currentConnected = false;
    networkListeners.forEach((h) => h({ connected: false }));
    appListeners.forEach((h) => h({ isActive: false }));
    appListeners.forEach((h) => h({ isActive: true }));
    await settle();

    expect(countActiveRefetches(spy)).toBe(0);
  });
});
