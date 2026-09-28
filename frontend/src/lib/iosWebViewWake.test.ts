import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
}));

type AppStateHandler = (state: { isActive: boolean }) => void;
const appStateHandlers: AppStateHandler[] = [];
const remove = vi.fn();

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (event: string, handler: AppStateHandler) => {
      if (event === "appStateChange") appStateHandlers.push(handler);
      return { remove };
    },
  },
}));

import { setupWebViewWake } from "./androidWebViewWake";

describe("iOS WKWebView wake recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appStateHandlers.length = 0;
    remove.mockReset();
    document.body.style.removeProperty("visibility");
    document.documentElement.style.removeProperty("transform");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.style.removeProperty("visibility");
    document.documentElement.style.removeProperty("transform");
  });

  async function mount() {
    const cleanup = setupWebViewWake();
    await vi.waitFor(() => expect(appStateHandlers).toHaveLength(1));
    return cleanup;
  }

  it("restores a visible document when WKWebView drops the compositor frame", async () => {
    const cleanup = await mount();
    appStateHandlers[0]({ isActive: true });
    expect(document.body.style.visibility).toBe("hidden");

    await vi.advanceTimersByTimeAsync(1_001);
    expect(document.body.style.visibility).toBe("");
    expect(document.documentElement.style.transform).toBe("");
    cleanup();
  });

  it("settles immediately if iOS backgrounds the app again during a wake", async () => {
    const cleanup = await mount();
    appStateHandlers[0]({ isActive: true });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.body.style.visibility).toBe("");
    expect(document.documentElement.style.transform).toBe("");
    cleanup();
  });

  it("coalesces overlapping iOS app, visibility, pageshow and focus signals", async () => {
    const cleanup = await mount();
    const raf = vi.mocked(requestAnimationFrame);
    appStateHandlers[0]({ isActive: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("focus"));

    expect(raf).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(document.body.style.visibility).toBe("");
    cleanup();
  });
});
