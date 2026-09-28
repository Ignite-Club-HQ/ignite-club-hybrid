import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  getDeliveredNotifications: vi.fn(),
  browserOpen: vi.fn(),
  preload: vi.fn(),
  captureJump: vi.fn(),
  normalizeChatUrl: vi.fn((_data: any, url: string | undefined) => url),
  getJumpTarget: vi.fn(),
  suppressScope: vi.fn(),
  prefetch: vi.fn(),
  mark: vi.fn(),
  remark: vi.fn(),
  startLongTaskWindow: vi.fn(),
  tapHandler: undefined as undefined | ((payload: any) => void),
}));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    addListener: mocks.addListener,
    getDeliveredNotifications: mocks.getDeliveredNotifications,
  },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.browserOpen } }));
vi.mock("./notificationPreload", () => ({
  preloadMessageFromNotification: mocks.preload,
}));
vi.mock("./pendingChatJump", () => ({
  captureJumpFromNotification: mocks.captureJump,
  normalizeNotificationChatUrl: mocks.normalizeChatUrl,
  getJumpTarget: mocks.getJumpTarget,
}));
vi.mock("./pushTapSuppression", () => ({ suppressChatScope: mocks.suppressScope }));
vi.mock("./chatChunkPrefetch", () => ({ prefetchChatChunkForUrl: mocks.prefetch }));
vi.mock("./coldStartMarks", () => ({
  mark: mocks.mark,
  remark: mocks.remark,
  startLongTaskWindow: mocks.startLongTaskWindow,
}));

type LaunchModule = typeof import("./notificationLaunchHandler");

async function loadHandler(native = true): Promise<LaunchModule> {
  vi.resetModules();
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => native },
  });
  mocks.addListener.mockImplementation((_event, handler) => {
    mocks.tapHandler = handler;
    return Promise.resolve({ remove: vi.fn() });
  });
  const module = await import("./notificationLaunchHandler");
  module.initNotificationLaunchHandler();
  return module;
}

function tap(data: Record<string, unknown>) {
  expect(mocks.tapHandler).toBeTypeOf("function");
  mocks.tapHandler!({ notification: { data } });
}

describe("native notification launch routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.tapHandler = undefined;
    mocks.getDeliveredNotifications.mockResolvedValue({ notifications: [] });
    mocks.browserOpen.mockResolvedValue(undefined);
    mocks.normalizeChatUrl.mockImplementation((_data, url) => url);
    mocks.getJumpTarget.mockReturnValue(null);
  });

  it("does not register the native listener in a web environment", async () => {
    await loadHandler(false);

    expect(mocks.addListener).not.toHaveBeenCalled();
    expect(mocks.getDeliveredNotifications).not.toHaveBeenCalled();
  });

  it("registers exactly one native tap listener and checks delivered notifications", async () => {
    await loadHandler();

    expect(mocks.addListener).toHaveBeenCalledOnce();
    expect(mocks.addListener).toHaveBeenCalledWith(
      "pushNotificationActionPerformed",
      expect.any(Function),
    );
    expect(mocks.getDeliveredNotifications).toHaveBeenCalledOnce();
  });

  it("navigates an internal warm tap immediately and broadcasts its routing context", async () => {
    const module = await loadHandler();
    const navigate = vi.fn();
    const tapped = vi.fn();
    window.addEventListener("ignite:notification-tapped", tapped);
    module.setNotificationNavigator(navigate);

    tap({ url: "https://ignite.invalid/messages/team-1?jump=message-1", type: "message" });

    expect(navigate).toHaveBeenCalledWith("/messages/team-1?jump=message-1");
    expect(module.peekPendingNotificationNavigation()).toBeNull();
    expect((tapped.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
      path: "/messages/team-1?jump=message-1",
      type: "message",
      isPitchBoard: false,
    }));
    window.removeEventListener("ignite:notification-tapped", tapped);
  });

  it("persists a cold-start route and consumes it only once after the router mounts", async () => {
    const module = await loadHandler();
    tap({ path: "/events/event-1", type: "event_updated" });

    expect(module.peekPendingNotificationNavigation()).toBe("/events/event-1");
    expect(sessionStorage.getItem("pendingPushNavigationUrl")).toBe("/events/event-1");
    const navigate = vi.fn();
    expect(module.processPendingNotificationNavigation(navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/events/event-1");
    expect(module.processPendingNotificationNavigation(navigate)).toBe(false);
  });

  it("retains the exact message route when cold-start bootstrap takes longer than the jump TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));
    mocks.normalizeChatUrl.mockImplementation((data, url) => {
      const parsed = new URL(url, "https://igniteclubhq.app");
      parsed.searchParams.set("message", data.message_id);
      parsed.searchParams.set("jump", String(Date.now()));
      return `${parsed.pathname}${parsed.search}`;
    });
    const module = await loadHandler();

    tap({
      type: "team_message",
      message_id: "exact-message-61s",
      url: "/messages/team-1?message=stale-message",
    });
    vi.setSystemTime(new Date("2026-07-27T00:01:01.000Z"));

    const navigate = vi.fn();
    expect(module.processPendingNotificationNavigation(navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(
      /^\/messages\/team-1\?(?=.*message=exact-message-61s)(?=.*jump=)/,
    ));
    expect(navigate.mock.calls[0][0]).not.toContain("message=stale-message");
    vi.useRealTimers();
  });

  it("keeps the newest exact message when two pushes are tapped before cold-start auth is ready", async () => {
    let nonce = 1_000;
    mocks.normalizeChatUrl.mockImplementation((data, url) => {
      const parsed = new URL(url, "https://igniteclubhq.app");
      parsed.searchParams.set("message", data.message_id);
      parsed.searchParams.set("jump", String(nonce++));
      return `${parsed.pathname}${parsed.search}`;
    });
    const module = await loadHandler();

    tap({
      type: "team_message",
      message_id: "older-tapped-message",
      url: "/messages/team-1",
    });
    tap({
      type: "team_message",
      message_id: "newer-tapped-message",
      url: "/messages/team-1",
    });

    expect(module.peekPendingNotificationNavigation()).toMatch(
      /^\/messages\/team-1\?(?=.*message=newer-tapped-message)(?=.*jump=1001)/,
    );
    const navigate = vi.fn();
    expect(module.processPendingNotificationNavigation(navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining(
      "message=newer-tapped-message",
    ));
    expect(navigate.mock.calls[0][0]).not.toContain("older-tapped-message");
  });

  it.each(["pending_sub", "half_time", "full_time", "game_finished", "formation_change", "game_kickoff", "pitch_board"])(
    "routes a %s notification without a URL to the pitch board",
    async type => {
      const module = await loadHandler();
      const navigate = vi.fn();
      module.setNotificationNavigator(navigate);

      tap({ notificationType: type });

      expect(navigate).toHaveBeenCalledWith("/");
    },
  );

  it("opens external URLs outside the SPA and does not stash a route", async () => {
    const module = await loadHandler();
    const navigate = vi.fn();
    module.setNotificationNavigator(navigate);

    tap({ url: "https://malicious.example/phishing" });
    await vi.waitFor(() => expect(mocks.browserOpen).toHaveBeenCalledWith({
      url: "https://malicious.example/phishing",
    }));

    expect(navigate).not.toHaveBeenCalled();
    expect(module.peekPendingNotificationNavigation()).toBeNull();
  });

  it("stashes the route when the warm navigator throws so navigation can be retried", async () => {
    const module = await loadHandler();
    module.setNotificationNavigator(() => {
      throw new Error("router unavailable");
    });

    tap({ url: "/club/club-1" });

    expect(module.peekPendingNotificationNavigation()).toBe("/club/club-1");
    expect(module.isNotificationNavigationHandled()).toBe(false);
  });

  it("captures, preloads, suppresses and prefetches a chat notification before navigation", async () => {
    const module = await loadHandler();
    const data = { url: "/messages/team-1", message_id: "message-1", team_id: "team-1" };
    mocks.getJumpTarget.mockReturnValue({ kind: "team", targetId: "team-1" });

    tap(data);

    expect(mocks.preload).toHaveBeenCalledWith(data);
    expect(mocks.captureJump).toHaveBeenCalledWith(data, "/messages/team-1");
    expect(mocks.suppressScope).toHaveBeenCalledWith("team", "team-1", 1800);
    expect(mocks.prefetch).toHaveBeenCalledWith("/messages/team-1");
    expect(module.peekPendingNotificationNavigation()).toBe("/messages/team-1");
  });

  it("stores and consumes a force-update prompt when no store URL is supplied", async () => {
    const module = await loadHandler();
    const prompt = vi.fn();
    window.addEventListener("force-update-prompt", prompt);

    tap({ force_update_prompt: "true" });

    expect(prompt).toHaveBeenCalledOnce();
    expect(module.consumePendingForceUpdatePrompt()).toEqual({ storeUrl: undefined });
    expect(module.consumePendingForceUpdatePrompt()).toBeNull();
    expect(module.peekPendingNotificationNavigation()).toBeNull();
    window.removeEventListener("force-update-prompt", prompt);
  });

  it("drops a malformed pending path instead of passing it to the router", async () => {
    sessionStorage.setItem("pendingPushNavigationUrl", "/");
    const module = await loadHandler();
    const navigate = vi.fn();

    expect(module.processPendingNotificationNavigation(navigate)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
