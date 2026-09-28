import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

async function renderHeight(platform: "web" | "android" | "ios", keyboardHeight: number, keyboardOpen: boolean) {
  vi.resetModules();
  vi.doMock("@capacitor/core", () => ({
    Capacitor: {
      isNativePlatform: () => platform !== "web",
      getPlatform: () => platform,
    },
  }));
  vi.doMock("@/hooks/useNativeKeyboardHeight", () => ({
    useNativeKeyboardHeight: () => keyboardHeight,
  }));
  vi.doMock("@/hooks/useKeyboardOpen", () => ({
    useKeyboardOpen: () => keyboardOpen,
  }));
  const { useChatViewportHeight } = await import("./useChatViewportHeight");
  return renderHook(() => useChatViewportHeight()).result.current;
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("useChatViewportHeight keyboard-safe message layout", () => {
  it("leaves web sizing to the dynamic parent while reserving bottom navigation", async () => {
    expect(await renderHeight("web", 0, false)).toBe(
      "calc(100% - var(--bottom-nav-offset, 4rem))",
    );
  });

  it.each(["android", "ios"] as const)("subtracts the exact native keyboard height on %s", async (platform) => {
    expect(await renderHeight(platform, 318, true)).toBe("calc(100% - 318px)");
  });

  it.each(["android", "ios"] as const)("restores bottom-nav space after the %s keyboard closes", async (platform) => {
    expect(await renderHeight(platform, 0, false)).toBe(
      "calc(100% - var(--bottom-nav-offset, 4rem))",
    );
  });

  it("does not subtract bottom navigation a second time while a native keyboard is open", async () => {
    const height = await renderHeight("android", 280, true);
    expect(height).toBe("calc(100% - 280px)");
    expect(height).not.toContain("bottom-nav-offset");
  });
});
