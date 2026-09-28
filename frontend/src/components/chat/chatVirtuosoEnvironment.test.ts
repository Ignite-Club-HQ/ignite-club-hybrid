import { describe, expect, it, vi } from "vitest";
import {
  escapeChatCssAttributeValue,
  handleVirtuosoResizeObserverError,
  isAndroidNativeWebView,
} from "./chatVirtuosoEnvironment";

describe("chat Virtuoso environment safety", () => {
  it("detects Android through the live Capacitor bridge", () => {
    expect(isAndroidNativeWebView({
      capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
      userAgent: "ordinary browser",
    })).toBe(true);
    expect(isAndroidNativeWebView({
      capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
      userAgent: "ordinary browser",
    })).toBe(false);
  });

  it("falls back safely to both supported Android WebView user-agent markers", () => {
    expect(isAndroidNativeWebView({ userAgent: "Mozilla/5.0 (Linux; Android 15; wv)" })).toBe(true);
    expect(isAndroidNativeWebView({ userAgent: "Android 15 IgniteClubHQ-Android" })).toBe(true);
    expect(isAndroidNativeWebView({ userAgent: "Android 15 Chrome/130" })).toBe(false);
    expect(isAndroidNativeWebView({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" })).toBe(false);
  });

  it("survives a temporarily unavailable native bridge", () => {
    expect(isAndroidNativeWebView({
      capacitor: {
        isNativePlatform: () => { throw new Error("bridge unavailable"); },
        getPlatform: () => "android",
      },
      userAgent: "Android IgniteClubHQ-Android",
    })).toBe(true);
  });

  it("uses native CSS escaping when available and a safe attribute fallback otherwise", () => {
    expect(escapeChatCssAttributeValue("message:id", (value) => `native:${value}`)).toBe("native:message:id");
    expect(escapeChatCssAttributeValue('message\\"id', null)).toBe('message\\\\\\"id');
  });

  it("suppresses only the known benign ResizeObserver loop error", () => {
    const benign = {
      message: "ResizeObserver loop completed with undelivered notifications.",
      stopImmediatePropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as ErrorEvent;
    expect(handleVirtuosoResizeObserverError(benign)).toBe(true);
    expect(benign.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(benign.preventDefault).toHaveBeenCalledOnce();

    const real = {
      message: "Realtime connection failed",
      stopImmediatePropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as ErrorEvent;
    expect(handleVirtuosoResizeObserverError(real)).toBe(false);
    expect(real.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(real.preventDefault).not.toHaveBeenCalled();
  });
});
