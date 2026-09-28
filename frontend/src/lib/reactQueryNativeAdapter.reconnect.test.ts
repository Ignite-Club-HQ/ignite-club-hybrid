/**
 * Regression: after a network drop → restore cycle, the club theme must
 * remain applied. The recovery path relies on `reactQueryNativeAdapter`
 * invalidating the theme-critical queries on reconnect so that any
 * background refetch fires the fallback logic in `useClubTheme` (which
 * keeps the cached theme when the club still appears in `userClubs`).
 *
 * This test drives the adapter directly by:
 *   1. Faking `Capacitor.isNativePlatform() === true`.
 *   2. Faking `@capacitor/network` so we can flip connectivity on demand.
 *   3. Faking `@capacitor/app` to no-op the foreground listener.
 *   4. Seeding a `QueryClient` with theme queries, then flipping offline →
 *      online and asserting that the theme-critical queries are marked
 *      stale (invalidated). Also confirms an errored query is invalidated
 *      so the theme provider can re-fetch and re-apply.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryObserver, onlineManager } from "@tanstack/react-query";

const { abortAllInFlightRestGets } = vi.hoisted(() => ({
  abortAllInFlightRestGets: vi.fn(() => 0),
}));
vi.mock("@/lib/supabaseAuthRetry", () => ({
  abortAllInFlightRestGets,
}));

// ---- Capacitor mocks ---------------------------------------------------
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));

type NetHandler = (status: { connected: boolean }) => void;
const networkListeners: NetHandler[] = [];
type AppStateHandler = (state: { isActive: boolean }) => void;
const appStateListeners: AppStateHandler[] = [];
let currentConnected = true;

const flipNetwork = (connected: boolean) => {
  currentConnected = connected;
  networkListeners.forEach((h) => h({ connected }));
};

vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: async () => ({ connected: currentConnected }),
    addListener: (_event: string, handler: NetHandler) => {
      networkListeners.push(handler);
      return { remove: () => {} };
    },
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (event: string, handler: AppStateHandler) => {
      if (event === "appStateChange") appStateListeners.push(handler);
      return Promise.resolve({ remove: () => {} });
    },
  },
}));

// Import AFTER mocks so the module picks them up.
import { setupReactQueryNativeAdapter } from "./reactQueryNativeAdapter";

describe("reactQueryNativeAdapter — reconnect preserves club theme", () => {
  let qc: QueryClient;

  beforeEach(() => {
    networkListeners.length = 0;
    appStateListeners.length = 0;
    currentConnected = true;
    abortAllInFlightRestGets.mockClear();
    onlineManager.setOnline(true);
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    qc.clear();
    vi.unstubAllGlobals();
  });

  it("invalidates theme-critical queries and errored queries on offline→online", async () => {
    // Seed the caches the adapter targets by name.
    qc.setQueryData(["club-themes", "user-1"], [{ clubId: "club-x" }]);
    qc.setQueryData(["user-clubs-for-switcher", "user-1"], [{ id: "club-x" }]);
    qc.setQueryData(["all-user-clubs-for-theme-v2", "user-1"], [{ clubId: "club-x" }]);

    // Seed an errored query to represent the messages/schedule fetch that
    // failed while offline. The adapter must kick this so the app recovers
    // without a relaunch.
    await qc.fetchQuery({
      queryKey: ["some-page-data"],
      queryFn: async () => {
        throw new Error("offline");
      },
    }).catch(() => {});

    setupReactQueryNativeAdapter(qc);
    // Let the async dynamic imports (@capacitor/network, @capacitor/app) resolve.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    // Drop the network — mirrors radio off / airplane mode.
    flipNetwork(false);
    expect(onlineManager.isOnline()).toBe(false);

    // Restore the network.
    flipNetwork(true);
    // Give the adapter's recovery microtask a chance to fire.
    await new Promise((r) => setTimeout(r, 5));

    expect(onlineManager.isOnline()).toBe(true);

    // The three theme-critical query keys must have been invalidated so
    // any subsequent background refetch feeds the theme provider's
    // fallback logic (which preserves the cached theme when the club is
    // still present in `userClubs`).
    const invalidatedKeys = invalidateSpy.mock.calls
      .map((c) => (c[0] as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(invalidatedKeys).toContain("club-themes");
    expect(invalidatedKeys).toContain("user-clubs-for-switcher");
    expect(invalidatedKeys).toContain("all-user-clubs-for-theme-v2");

    // AND the errored non-theme query is kicked so pages recover.
    expect(invalidatedKeys).toContain("some-page-data");

    // The cached theme data itself must survive (never removed by the
    // adapter — that's the whole guarantee behind theme persistence).
    expect(qc.getQueryData(["club-themes", "user-1"])).toEqual([
      { clubId: "club-x" },
    ]);
    expect(qc.getQueryData(["user-clubs-for-switcher", "user-1"])).toEqual([
      { id: "club-x" },
    ]);
  });

  it("does not refetch active Inbox, Schedule or Media queries on an ordinary online Android resume", async () => {
    const keys = [
      ["my-teams-with-messages", "user-1"],
      ["events", "user-1", "all"],
      ["photos", "user-1", "all"],
    ] as const;
    const observers = keys.map((queryKey) => {
      qc.setQueryData(queryKey, []);
      const observer = new QueryObserver(qc, {
        queryKey,
        queryFn: async () => [],
        staleTime: Infinity,
      });
      return { observer, unsubscribe: observer.subscribe(() => {}) };
    });
    const refetchSpy = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined as never);

    setupReactQueryNativeAdapter(qc);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(appStateListeners).toHaveLength(1);

    appStateListeners[0]({ isActive: false });
    appStateListeners[0]({ isActive: true });
    await new Promise((r) => setTimeout(r, 350));

    expect(onlineManager.isOnline()).toBe(true);
    const surfaceRefetches = refetchSpy.mock.calls.filter(([options]) =>
      keys.some((key) =>
        JSON.stringify((options as { queryKey?: readonly unknown[] }).queryKey) === JSON.stringify(key),
      ),
    );
    expect(surfaceRefetches).toHaveLength(0);

    observers.forEach(({ unsubscribe, observer }) => {
      unsubscribe();
      observer.destroy();
    });
  });

  it("refetches active Inbox, Schedule and Media queries after a genuine offline→online resume", async () => {
    const keys = [
      ["my-teams-with-messages", "user-1"],
      ["events", "user-1", "all"],
      ["photos", "user-1", "all"],
    ] as const;
    const observers = keys.map((queryKey) => {
      qc.setQueryData(queryKey, []);
      const observer = new QueryObserver(qc, {
        queryKey,
        queryFn: async () => [],
        staleTime: Infinity,
      });
      return { observer, unsubscribe: observer.subscribe(() => {}) };
    });
    const refetchSpy = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined as never);

    setupReactQueryNativeAdapter(qc);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    appStateListeners[0]({ isActive: false });
    flipNetwork(false);
    expect(onlineManager.isOnline()).toBe(false);

    currentConnected = true;
    appStateListeners[0]({ isActive: true });
    await new Promise((r) => setTimeout(r, 350));

    expect(onlineManager.isOnline()).toBe(true);
    const refetched = refetchSpy.mock.calls.map(
      ([options]) => (options as { queryKey?: readonly unknown[] }).queryKey,
    );
    for (const key of keys) expect(refetched).toContainEqual(key);

    observers.forEach(({ unsubscribe, observer }) => {
      unsubscribe();
      observer.destroy();
    });
  });

  it("does not create a refetch storm from repeated online Android resume signals", async () => {
    const observers = Array.from({ length: 30 }, (_, index) => {
      const surface = index < 18 ? "inbox" : index < 24 ? "schedule" : "media";
      const queryKey = [surface, "android-stress", index] as const;
      qc.setQueryData(queryKey, []);
      const observer = new QueryObserver(qc, {
        queryKey,
        queryFn: async () => [],
        staleTime: Infinity,
      });
      return { queryKey, observer, unsubscribe: observer.subscribe(() => {}) };
    });
    const refetchSpy = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined as never);

    setupReactQueryNativeAdapter(qc);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    appStateListeners[0]({ isActive: false });
    for (let i = 0; i < 4; i += 1) appStateListeners[0]({ isActive: true });
    await new Promise((r) => setTimeout(r, 750));

    const stressCalls = refetchSpy.mock.calls.filter(([options]) =>
      (options as { queryKey?: readonly unknown[] }).queryKey?.[1] === "android-stress",
    );
    expect(stressCalls).toHaveLength(0);

    observers.forEach(({ unsubscribe, observer }) => {
      unsubscribe();
      observer.destroy();
    });
  });

  it("recovers active queries once when networkStatusChange reports a genuine reconnect", async () => {
    const queryKey = ["events", "network-callback"] as const;
    qc.setQueryData(queryKey, []);
    const observer = new QueryObserver(qc, {
      queryKey,
      queryFn: async () => [],
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const refetchSpy = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined as never);

    setupReactQueryNativeAdapter(qc);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    flipNetwork(false);
    flipNetwork(true);
    flipNetwork(true);
    await new Promise((r) => setTimeout(r, 350));

    const calls = refetchSpy.mock.calls.filter(([options]) =>
      JSON.stringify((options as { queryKey?: readonly unknown[] }).queryKey) === JSON.stringify(queryKey),
    );
    expect(calls).toHaveLength(1);

    unsubscribe();
    observer.destroy();
  });

  it("does not refetch active queries when Android resumes and remains offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const queryKey = ["photos", "still-offline"] as const;
    qc.setQueryData(queryKey, []);
    const observer = new QueryObserver(qc, {
      queryKey,
      queryFn: async () => [],
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const refetchSpy = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined as never);

    setupReactQueryNativeAdapter(qc);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    flipNetwork(false);
    appStateListeners[0]({ isActive: false });
    appStateListeners[0]({ isActive: true });
    await new Promise((r) => setTimeout(r, 50));

    expect(onlineManager.isOnline()).toBe(false);
    const calls = refetchSpy.mock.calls.filter(([options]) =>
      JSON.stringify((options as { queryKey?: readonly unknown[] }).queryKey) === JSON.stringify(queryKey),
    );
    expect(calls).toHaveLength(0);

    unsubscribe();
    observer.destroy();
  });

  it("aborts zombie REST reads only after a long Android background interval", async () => {
    const now = vi.spyOn(Date, "now");
    setupReactQueryNativeAdapter(qc);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    now.mockReturnValue(100_000);
    appStateListeners[0]({ isActive: false });
    now.mockReturnValue(119_999);
    appStateListeners[0]({ isActive: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(abortAllInFlightRestGets).not.toHaveBeenCalled();

    now.mockReturnValue(200_000);
    appStateListeners[0]({ isActive: false });
    now.mockReturnValue(220_001);
    appStateListeners[0]({ isActive: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(abortAllInFlightRestGets).toHaveBeenCalledTimes(1);
    expect(abortAllInFlightRestGets).toHaveBeenCalledWith("app-resume");

    now.mockRestore();
  });
});
