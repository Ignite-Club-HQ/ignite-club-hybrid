import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setQueryData: vi.fn(),
  auth: { user: { id: "user-1" } as null | { id: string } },
  native: false,
  useNativePush: vi.fn(),
  useRealtimePerfSampler: vi.fn(),
  usePushSubscriptionHealth: vi.fn(),
  useMissedNotificationSync: vi.fn(),
  clearStalePushLocks: vi.fn(),
  consumePending: vi.fn(),
  preload: vi.fn(),
  captureJump: vi.fn(),
  normalizeUrl: vi.fn((_data: any, url: string) => url),
  getJumpTarget: vi.fn(),
  suppressScope: vi.fn(),
  broadcastHandler: undefined as undefined | ((event: { data: any }) => void),
  broadcastClose: vi.fn(),
  swHandler: undefined as undefined | ((event: MessageEvent) => void),
  swAdd: vi.fn(),
  swRemove: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mocks.setQueryData }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/useNativePush", () => ({ useNativePush: mocks.useNativePush }));
vi.mock("@/hooks/useRealtimePerfSampler", () => ({ useRealtimePerfSampler: mocks.useRealtimePerfSampler }));
vi.mock("@/hooks/usePushSubscriptionHealth", () => ({ usePushSubscriptionHealth: mocks.usePushSubscriptionHealth }));
vi.mock("@/hooks/useMissedNotificationSync", () => ({ useMissedNotificationSync: mocks.useMissedNotificationSync }));
vi.mock("@/lib/pushNotifications", () => ({ clearStalePushLocks: mocks.clearStalePushLocks }));
vi.mock("@/lib/nativePush", () => ({
  getPlatform: () => "web",
  isNativePlatform: () => mocks.native,
}));
vi.mock("@/lib/webNotificationLaunchHandler", () => ({ consumePendingWebPushNav: mocks.consumePending }));
vi.mock("@/lib/notificationPreload", () => ({ preloadMessageFromNotification: mocks.preload }));
vi.mock("@/lib/pendingChatJump", () => ({
  captureJumpFromNotification: mocks.captureJump,
  normalizeNotificationChatUrl: mocks.normalizeUrl,
  getJumpTarget: mocks.getJumpTarget,
}));
vi.mock("@/lib/pushTapSuppression", () => ({ suppressChatScope: mocks.suppressScope }));

class BroadcastChannelMock {
  onmessage: ((event: { data: any }) => void) | null = null;
  close = mocks.broadcastClose;
  constructor(_name: string) {
    queueMicrotask(() => {
      mocks.broadcastHandler = event => this.onmessage?.(event);
    });
  }
}

import { PushNotificationManager } from "./PushNotificationManager";

describe("PushNotificationManager orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.user = { id: "user-1" };
    mocks.native = false;
    mocks.consumePending.mockReturnValue(null);
    mocks.normalizeUrl.mockImplementation((_data, url) => url);
    mocks.getJumpTarget.mockReturnValue(null);
    mocks.broadcastHandler = undefined;
    mocks.swHandler = undefined;
    mocks.swAdd.mockImplementation((_type, handler) => {
      mocks.swHandler = handler;
    });
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: BroadcastChannelMock,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { addEventListener: mocks.swAdd, removeEventListener: mocks.swRemove },
    });
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => vi.useRealTimers());

  it("starts each supporting hook with the correctly scoped user", () => {
    render(<PushNotificationManager />);

    expect(mocks.useNativePush).toHaveBeenCalledWith("user-1");
    expect(mocks.useRealtimePerfSampler).toHaveBeenCalledWith("user-1");
    expect(mocks.usePushSubscriptionHealth).toHaveBeenCalledWith("user-1");
    expect(mocks.useMissedNotificationSync).toHaveBeenCalledWith("user-1");
  });

  it.each([
    ["team", "team-1", ["team-messages", "team-1"]],
    ["club", "club-1", ["club-messages", "club-1"]],
    ["group", "group-1", ["group-messages", "group-1"]],
    ["dm", "conversation-1", ["dm-messages", "conversation-1"]],
    ["broadcast", "broadcast", ["broadcast-messages"]],
    ["club_admin", "club-1", ["club-admin-messages", "club-1"]],
  ])("routes a %s preload event to its exact query cache", (kind, targetId, expectedKey) => {
    render(<PushNotificationManager />);
    const message = { id: "message-1", text: "Update" };

    act(() => window.dispatchEvent(new CustomEvent("ignite:preload-message", {
      detail: { kind, targetId, message },
    })));

    expect(mocks.setQueryData).toHaveBeenCalledWith(expectedKey, expect.any(Function));
    const updater = mocks.setQueryData.mock.calls[0][1];
    expect(updater([{ id: "old-message" }])).toEqual([{ id: "old-message" }, message]);
  });

  it("preserves paged cache shape and suppresses duplicate preloaded messages", () => {
    render(<PushNotificationManager />);
    const message = { id: "message-1", text: "Update" };
    act(() => window.dispatchEvent(new CustomEvent("ignite:preload-message", {
      detail: { kind: "team", targetId: "team-1", message },
    })));

    const updater = mocks.setQueryData.mock.calls[0][1];
    const paged = { messages: [{ id: "old-message" }], cursor: "cursor-1" };
    expect(updater(paged)).toEqual({ ...paged, messages: [{ id: "old-message" }, message] });
    const existing = { messages: [message], cursor: "cursor-1" };
    expect(updater(existing)).toBe(existing);
    expect(updater(undefined)).toBeUndefined();
  });

  it("ignores malformed and unknown preload events", () => {
    render(<PushNotificationManager />);
    act(() => {
      window.dispatchEvent(new CustomEvent("ignite:preload-message", { detail: {} }));
      window.dispatchEvent(new CustomEvent("ignite:preload-message", {
        detail: { kind: "unknown", targetId: "x", message: { id: "message-1" } },
      }));
    });
    expect(mocks.setQueryData).not.toHaveBeenCalled();
  });

  it("opens the pitch board once with the notification type after the delay", async () => {
    vi.useFakeTimers();
    const opened = vi.fn();
    window.addEventListener("open-pitch-board", opened);
    render(<PushNotificationManager />);

    act(() => window.dispatchEvent(new CustomEvent("ignite:notification-tapped", {
      detail: { isPitchBoard: true, type: "game_kickoff" },
    })));
    expect(localStorage.getItem("pitch-board-open-source")).toBe("game_kickoff");
    expect(opened).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(opened).toHaveBeenCalledOnce();
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ notificationType: "game_kickoff" });
    window.removeEventListener("open-pitch-board", opened);
  });

  it("consumes a pending internal web route on mount", () => {
    mocks.consumePending.mockReturnValue("https://ignite.invalid/messages/team-1?jump=message-1#target");
    render(<PushNotificationManager />);

    expect(mocks.navigate).toHaveBeenCalledWith("/messages/team-1?jump=message-1#target");
    expect(window.open).not.toHaveBeenCalled();
  });

  it("opens a pending external route in a new tab instead of SPA navigation", () => {
    mocks.consumePending.mockReturnValue("https://external.example/help");
    render(<PushNotificationManager />);

    expect(window.open).toHaveBeenCalledWith("https://external.example/help", "_blank");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("preloads, captures, suppresses and routes a BroadcastChannel notification", async () => {
    mocks.normalizeUrl.mockReturnValue("/messages/team-1?jump=message-1");
    mocks.getJumpTarget.mockReturnValue({ kind: "team", targetId: "team-1" });
    render(<PushNotificationManager />);
    await act(async () => Promise.resolve());
    const data = { message_id: "message-1", team_id: "team-1" };

    act(() => mocks.broadcastHandler!({ data: { url: "/messages/team-1", data } }));

    expect(mocks.preload).toHaveBeenCalledWith(data);
    expect(mocks.captureJump).toHaveBeenCalledWith(data, "/messages/team-1?jump=message-1");
    expect(mocks.suppressScope).toHaveBeenCalledWith("team", "team-1", 1800);
    expect(mocks.navigate).toHaveBeenCalledWith("/messages/team-1?jump=message-1");
  });

  it("accepts only correctly typed service-worker navigation messages", () => {
    render(<PushNotificationManager />);
    act(() => mocks.swHandler!({ data: { type: "CACHE_REFRESH", url: "/wrong" } } as MessageEvent));
    expect(mocks.navigate).not.toHaveBeenCalled();

    act(() => mocks.swHandler!({
      data: { type: "NOTIFICATION_CLICK_NAVIGATE", url: "/events/event-1" },
    } as MessageEvent));
    expect(mocks.navigate).toHaveBeenCalledWith("/events/event-1");
  });

  it("removes window, service-worker and BroadcastChannel listeners on unmount", async () => {
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<PushNotificationManager />);
    await act(async () => Promise.resolve());
    unmount();

    expect(mocks.broadcastClose).toHaveBeenCalledOnce();
    expect(mocks.swRemove).toHaveBeenCalledWith("message", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("ignite:preload-message", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("ignite:notification-tapped", expect.any(Function));
  });
});
