import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preload: vi.fn(),
  captureJump: vi.fn(),
  normalizeChatUrl: vi.fn((_data: any, url: string | undefined) => url),
  prefetch: vi.fn(),
  mark: vi.fn(),
  remark: vi.fn(),
  startLongTaskWindow: vi.fn(),
  broadcastConstruct: vi.fn(),
  broadcastHandler: undefined as undefined | ((event: { data: any }) => void),
  serviceWorkerHandler: undefined as undefined | ((event: MessageEvent) => void),
}));

vi.mock("./notificationPreload", () => ({ preloadMessageFromNotification: mocks.preload }));
vi.mock("./pendingChatJump", () => ({
  captureJumpFromNotification: mocks.captureJump,
  normalizeNotificationChatUrl: mocks.normalizeChatUrl,
  getJumpTarget: vi.fn(() => null),
}));
vi.mock("./chatChunkPrefetch", () => ({ prefetchChatChunkForUrl: mocks.prefetch }));
vi.mock("./coldStartMarks", () => ({
  mark: mocks.mark,
  remark: mocks.remark,
  startLongTaskWindow: mocks.startLongTaskWindow,
}));

class BroadcastChannelMock {
  private handler?: (event: { data: any }) => void;
  private listeners = new Set<(event: { data: any }) => void>();

  constructor(name: string) {
    mocks.broadcastConstruct(name);
  }

  set onmessage(handler: ((event: { data: any }) => void) | null) {
    this.handler = handler ?? undefined;
    mocks.broadcastHandler = this.handler;
  }

  addEventListener(type: string, handler: (event: { data: any }) => void) {
    if (type === "message") this.listeners.add(handler);
  }

  removeEventListener(type: string, handler: (event: { data: any }) => void) {
    if (type === "message") this.listeners.delete(handler);
  }

  postMessage(data: any) {
    const event = { data };
    this.handler?.(event);
    for (const listener of this.listeners) listener(event);
  }

  close() {
    this.handler = undefined;
    this.listeners.clear();
  }
}

async function initialise(native = false) {
  vi.resetModules();
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => native },
  });
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: BroadcastChannelMock,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      addEventListener: vi.fn((_event: string, handler: (event: MessageEvent) => void) => {
        mocks.serviceWorkerHandler = handler;
      }),
    },
  });
  const module = await import("./webNotificationLaunchHandler");
  module.initWebNotificationLaunchHandler();
  return module;
}

describe("web notification launch routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.broadcastHandler = undefined;
    mocks.serviceWorkerHandler = undefined;
    mocks.normalizeChatUrl.mockImplementation((_data, url) => url);
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("installs one BroadcastChannel and service-worker message listener", async () => {
    await initialise();

    // Supabase Auth also owns a BroadcastChannel. Assert only this feature's
    // channel rather than treating unrelated standards-compliant consumers as
    // an error.
    expect(mocks.broadcastConstruct.mock.calls.filter(([name]) => name === "push-nav"))
      .toHaveLength(1);
    expect(mocks.broadcastHandler).toBeTypeOf("function");
    expect(mocks.serviceWorkerHandler).toBeTypeOf("function");
  });

  it("does not install web listeners on a native platform", async () => {
    await initialise(true);

    expect(mocks.broadcastConstruct.mock.calls.filter(([name]) => name === "push-nav"))
      .toHaveLength(0);
    expect(mocks.serviceWorkerHandler).toBeUndefined();
  });

  it("stashes and consumes an internal route received over BroadcastChannel", async () => {
    const module = await initialise();

    mocks.broadcastHandler!({ data: { url: "/messages/team-1", team_id: "team-1" } });

    expect(sessionStorage.getItem("ignite_pending_web_push_nav")).toBe("/messages/team-1");
    expect(module.consumePendingWebPushNav()).toBe("/messages/team-1");
    expect(module.consumePendingWebPushNav()).toBeNull();
  });

  it("accepts only notification-click messages from the service worker", async () => {
    const module = await initialise();

    mocks.serviceWorkerHandler!({ data: { type: "CACHE_REFRESH", url: "/wrong" } } as MessageEvent);
    expect(module.consumePendingWebPushNav()).toBeNull();

    mocks.serviceWorkerHandler!({
      data: { type: "NOTIFICATION_CLICK_NAVIGATE", url: "/events/event-1" },
    } as MessageEvent);
    expect(module.consumePendingWebPushNav()).toBe("/events/event-1");
  });

  it("uses the normalized chat URL and prepares the jump before route consumption", async () => {
    const module = await initialise();
    const payload = {
      url: "/messages/team-1",
      data: { message_id: "message-1", team_id: "team-1" },
    };
    mocks.normalizeChatUrl.mockReturnValue("/messages/team-1?jump=message-1");

    mocks.broadcastHandler!({ data: payload });

    expect(mocks.captureJump).toHaveBeenCalledWith(
      payload.data,
      "/messages/team-1?jump=message-1",
    );
    expect(mocks.prefetch).toHaveBeenCalledWith("/messages/team-1?jump=message-1");
    expect(module.consumePendingWebPushNav()).toBe("/messages/team-1?jump=message-1");
  });

  it("opens an external URL in a protected tab without stashing an SPA route", async () => {
    const module = await initialise();

    mocks.broadcastHandler!({ data: { url: "https://malicious.example/phishing" } });

    expect(window.open).toHaveBeenCalledWith(
      "https://malicious.example/phishing",
      "_blank",
      "noopener",
    );
    expect(module.consumePendingWebPushNav()).toBeNull();
    expect(mocks.preload).not.toHaveBeenCalled();
  });

  it("opens a force-update store URL and emits the prompt without routing the SPA", async () => {
    const module = await initialise();
    const prompt = vi.fn();
    window.addEventListener("force-update-prompt", prompt);

    mocks.broadcastHandler!({
      data: { force_update_prompt: "true", store_url: "https://store.example/app" },
    });

    expect(window.open).toHaveBeenCalledWith(
      "https://store.example/app",
      "_blank",
      "noopener",
    );
    expect(prompt).toHaveBeenCalledOnce();
    expect(module.consumePendingWebPushNav()).toBeNull();
    window.removeEventListener("force-update-prompt", prompt);
  });

  it("still preloads a valid message payload when no navigation URL is present", async () => {
    const module = await initialise();
    const data = { message_id: "message-1", author_id: "author-1", team_id: "team-1" };

    mocks.broadcastHandler!({ data });

    expect(mocks.preload).toHaveBeenCalledWith(data);
    expect(mocks.captureJump).not.toHaveBeenCalled();
    expect(mocks.prefetch).not.toHaveBeenCalled();
    expect(module.consumePendingWebPushNav()).toBeNull();
  });
});
