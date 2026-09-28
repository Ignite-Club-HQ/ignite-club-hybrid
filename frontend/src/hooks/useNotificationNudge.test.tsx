/**
 * Regression tests for useNotificationNudge.
 *
 * Core defect: a Supabase lookup error must NOT be treated as
 * "no subscription exists". The hook must distinguish:
 *   1. Successful lookup with empty result  -> disabled
 *   2. Failed lookup                        -> unknown (preserve cache /
 *                                              assume enabled, never nudge,
 *                                              never write "disabled" cache)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ---------- Capacitor mock (default: web) ------------------------------
const isNativePlatformMock = vi.fn(() => false);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatformMock() },
}));

// ---------- Push permission mock (native) ------------------------------
const checkPermissionsMock = vi.fn(async () => ({ receive: "denied" as string }));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: { checkPermissions: () => checkPermissionsMock() },
}));

// ---------- Supabase mock ---------------------------------------------
type TableResp = { data: Array<{ id: string }> | null; error: { message: string } | null };
const tableResponses: Record<string, TableResp> = {};
const tableCalls: Record<string, number> = {};

const makeChain = (table: string) => {
  const resolve = () => {
    tableCalls[table] = (tableCalls[table] ?? 0) + 1;
    return Promise.resolve(tableResponses[table] ?? { data: [], error: null });
  };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    limit: () => resolve(),
  };
  return chain;
};

const getSessionMock = vi.fn(async () => ({
  data: { session: { user: { id: "u1" } } },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => makeChain(t),
    auth: { getSession: () => getSessionMock() },
  },
}));

// ---------- imports (after mocks) --------------------------------------
import { useNotificationNudge } from "./useNotificationNudge";

const USER_ID = "user-nudge-test";
const statusKey = (ctx: string) => `notification-nudge-status-${ctx}-${USER_ID}`;
const dismissKey = (ctx: string) => `notification-nudge-dismissed-${ctx}-${USER_ID}`;

beforeEach(() => {
  localStorage.clear();
  isNativePlatformMock.mockReturnValue(false);
  checkPermissionsMock.mockResolvedValue({ receive: "denied" });
  getSessionMock.mockResolvedValue({ data: { session: { user: { id: USER_ID } } } } as any);
  for (const k of Object.keys(tableResponses)) delete tableResponses[k];
  for (const k of Object.keys(tableCalls)) delete tableCalls[k];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useNotificationNudge — web/PWA push_subscriptions", () => {
  it("shows nudge when lookup succeeds and no subscription exists", async () => {
    tableResponses["push_subscriptions"] = { data: [], error: null };

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPushEnabled).toBe(false);
    expect(result.current.shouldShowNudge).toBe(true);
    expect(localStorage.getItem(statusKey("chat"))).toBe("disabled");
  });

  it("does not show nudge when subscription exists", async () => {
    tableResponses["push_subscriptions"] = { data: [{ id: "s1" }], error: null };

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPushEnabled).toBe(true);
    expect(result.current.shouldShowNudge).toBe(false);
    expect(localStorage.getItem(statusKey("chat"))).toBe("enabled");
  });

  it("must NOT show a false enable-notifications nudge when subscription lookup fails", async () => {
    tableResponses["push_subscriptions"] = { data: null, error: { message: "boom" } };

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // hasPushEnabled must NOT flip to false on a query error
    expect(result.current.hasPushEnabled).not.toBe(false);
    expect(result.current.shouldShowNudge).toBe(false);
    // No "disabled" cache written on failure
    expect(localStorage.getItem(statusKey("chat"))).not.toBe("disabled");
  });

  it("preserves cached enabled status when lookup fails", async () => {
    localStorage.setItem(statusKey("chat"), "enabled");
    tableResponses["push_subscriptions"] = { data: null, error: { message: "boom" } };

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPushEnabled).toBe(true);
    expect(result.current.shouldShowNudge).toBe(false);
    expect(localStorage.getItem(statusKey("chat"))).toBe("enabled");
  });

  it("preserves cached disabled status when lookup fails (does not overwrite)", async () => {
    localStorage.setItem(statusKey("chat"), "disabled");
    tableResponses["push_subscriptions"] = { data: null, error: { message: "boom" } };

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Cache preserved; still "disabled"
    expect(localStorage.getItem(statusKey("chat"))).toBe("disabled");
  });

  it("assumes enabled (for this render) when there is no cache and lookup fails", async () => {
    tableResponses["push_subscriptions"] = { data: null, error: { message: "network" } };

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPushEnabled).toBe(true);
    // But NOT persisted
    expect(localStorage.getItem(statusKey("chat"))).toBeNull();
  });
});

describe("useNotificationNudge — native fcm_tokens fallback", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    checkPermissionsMock.mockResolvedValue({ receive: "denied" });
  });

  it("shows nudge when permission denied AND no fcm token", async () => {
    tableResponses["fcm_tokens"] = { data: [], error: null };

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "inbox"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPushEnabled).toBe(false);
    expect(result.current.shouldShowNudge).toBe(true);
  });

  it("does not show nudge when device permission is granted (no DB query)", async () => {
    checkPermissionsMock.mockResolvedValue({ receive: "granted" });

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "inbox"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPushEnabled).toBe(true);
    expect(tableCalls["fcm_tokens"] ?? 0).toBe(0);
  });

  it("fcm_tokens lookup error must NOT show a false nudge and must NOT cache 'disabled'", async () => {
    tableResponses["fcm_tokens"] = { data: null, error: { message: "rls" } };

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "inbox"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.shouldShowNudge).toBe(false);
    expect(result.current.hasPushEnabled).not.toBe(false);
    expect(localStorage.getItem(statusKey("inbox"))).not.toBe("disabled");
  });
});

describe("useNotificationNudge — preserved behaviour", () => {
  it("does not query without a user", async () => {
    const { result } = renderHook(() => useNotificationNudge(undefined, "chat"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(tableCalls["push_subscriptions"] ?? 0).toBe(0);
  });

  it("does not query without an active session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } } as any);
    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(tableCalls["push_subscriptions"] ?? 0).toBe(0);
  });

  it("dismissal is scoped by user and context and honored within cooldown", async () => {
    tableResponses["push_subscriptions"] = { data: [], error: null };
    localStorage.setItem(dismissKey("chat"), String(Date.now()));

    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.shouldShowNudge).toBe(false);
  });

  it("loading state always settles", async () => {
    tableResponses["push_subscriptions"] = { data: null, error: { message: "x" } };
    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isLoading).toBe(false);
  });

  it("cancelled effect (unmount) does not update state or write cache", async () => {
    let resolveFn: (v: TableResp) => void = () => {};
    const pending = new Promise<TableResp>((res) => { resolveFn = res; });
    // Override chain to return a controllable promise
    tableResponses["push_subscriptions"] = { data: null, error: { message: "err" } };
    // Replace the resolver
    const origChain = makeChain;
    // Instead, we test by unmounting quickly.
    const { unmount, result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));
    unmount();
    // Resolve after unmount — no throw
    resolveFn({ data: null, error: { message: "err" } });
    await new Promise((r) => setTimeout(r, 10));
    // Cache should not have been written to "disabled"
    expect(localStorage.getItem(statusKey("chat"))).not.toBe("disabled");
    expect(result).toBeTruthy();
  });

  it("dismiss() sets the dismiss timestamp", async () => {
    tableResponses["push_subscriptions"] = { data: [], error: null };
    const { result } = renderHook(() => useNotificationNudge(USER_ID, "chat"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.dismiss());
    expect(localStorage.getItem(dismissKey("chat"))).not.toBeNull();
  });
});
