import { describe, expect, it, vi } from "vitest";
import { describeIcpSignInError, isLikelyInAppBrowser } from "./internetIdentitySignInHelp";

describe("describeIcpSignInError", () => {
  it("explains the channel-closed error with retry and browser guidance", () => {
    const result = describeIcpSignInError("Channel was closed before a response was received");
    expect(result).toContain("closed before sign-in finished");
    expect(result).toContain("leave the Internet Identity window open");
    expect(result).toContain("your device's browser");
    expect(result).not.toMatch(/Chrome|Safari/);
    expect(result).not.toContain("Channel was closed");
  });

  it("explains the window-closed-before-established error the same way", () => {
    const result = describeIcpSignInError("The signer window was closed before it could be established");
    expect(result).toContain("leave the Internet Identity window open");
  });

  it("explains a blocked pop-up", () => {
    const result = describeIcpSignInError("Signer window could not be opened");
    expect(result).toContain("blocked the sign-in window");
    expect(result).toContain("pop-ups");
    expect(result).toContain("your device's browser");
    expect(result).not.toMatch(/Chrome|Safari/);
  });

  it("explains the outside-click-handler error as a simple retry", () => {
    const result = describeIcpSignInError("Signer window should not be opened outside of click handler");
    expect(result).toContain("tap the button again");
  });

  it("passes unrecognized errors through unchanged", () => {
    expect(describeIcpSignInError("Some other failure")).toBe("Some other failure");
  });
});

describe("isLikelyInAppBrowser", () => {
  it("detects an Android WebView", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36; wv)",
    });
    expect(isLikelyInAppBrowser()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("detects Instagram's in-app browser", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0.0.0.0",
    });
    expect(isLikelyInAppBrowser()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("does not flag plain mobile Chrome", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    });
    expect(isLikelyInAppBrowser()).toBe(false);
    vi.unstubAllGlobals();
  });
});
