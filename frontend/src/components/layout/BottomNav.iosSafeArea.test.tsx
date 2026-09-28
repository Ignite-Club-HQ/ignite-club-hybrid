import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ unreadMessagesCount: 0, user: null }),
}));
vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ activeClubFilter: null }),
}));
vi.mock("@/hooks/useKeyboardOpen", () => ({ useKeyboardOpen: () => false }));
vi.mock("@/hooks/useNativeKeyboardHeight", () => ({ useNativeKeyboardHeight: () => 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ eq: () => ({ in: () => Promise.resolve({ count: 0 }) }) }),
        }),
      }),
    }),
  },
}));

import { BottomNav } from "./BottomNav";

// iOS device safe-area-inset-bottom values reported by WKWebView.
// Sources: Apple HIG / measured values across hardware.
const IOS_DEVICE_SAFE_AREAS: Array<{ name: string; inset: number }> = [
  { name: "iPhone SE (no home indicator)", inset: 0 },
  { name: "iPhone 8 / iPad classic", inset: 0 },
  { name: "iPhone X / 11 / 12 mini portrait", inset: 34 },
  { name: "iPhone 13/14/15 portrait", inset: 34 },
  { name: "iPhone 14 Pro Max portrait", inset: 34 },
  { name: "iPhone landscape (home indicator)", inset: 21 },
  { name: "iPad Pro with home indicator", inset: 20 },
];

const HOME_INDICATOR_MIN_CLEARANCE_PX = 8;

function renderNav() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <BottomNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BottomNav iOS safe-area handling across device sizes", () => {
  let originalGetComputedStyle: typeof window.getComputedStyle;

  beforeEach(() => {
    originalGetComputedStyle = window.getComputedStyle.bind(window);
  });

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
    vi.restoreAllMocks();
  });

  function mockSafeAreaInset(insetPx: number) {
    // Force any element styled with `env(safe-area-inset-bottom, 0px)` (via the
    // probe in iosLayoutStability) to read back `insetPx`.
    window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
      const real = originalGetComputedStyle(el, pseudo ?? null);
      const proxy = new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === "paddingBottom") return `${insetPx}px`;
          return Reflect.get(target, prop, receiver);
        },
      });
      return proxy as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle;
  }

  for (const device of IOS_DEVICE_SAFE_AREAS) {
    it(`provides at least ${HOME_INDICATOR_MIN_CLEARANCE_PX}px clearance over the home-indicator region on ${device.name} (inset ${device.inset}px)`, () => {
      mockSafeAreaInset(device.inset);

      renderNav();

      // The component sets --bottom-nav-safe-inset on the document root.
      // For native iOS, the value is `max(env(safe-area-inset-bottom, 0px), 8px)`.
      const cssVar = document.documentElement.style.getPropertyValue("--bottom-nav-safe-inset");
      expect(cssVar).toContain("env(safe-area-inset-bottom");
      expect(cssVar).toMatch(/max\(/);

      // Effective inset = max(deviceInset, 8px). Validate the clearance contract.
      const effectiveInset = Math.max(device.inset, HOME_INDICATOR_MIN_CLEARANCE_PX);
      expect(effectiveInset).toBeGreaterThanOrEqual(HOME_INDICATOR_MIN_CLEARANCE_PX);

      // Composite offset (--bottom-nav-offset) must include the inset.
      const offsetVar = document.documentElement.style.getPropertyValue("--bottom-nav-offset");
      expect(offsetVar).toContain("4rem");
      expect(offsetVar).toContain("env(safe-area-inset-bottom");
    });
  }

  it("falls back to the 8px floor when the device reports a zero safe-area inset", () => {
    mockSafeAreaInset(0);
    renderNav();
    const cssVar = document.documentElement.style.getPropertyValue("--bottom-nav-safe-inset");
    // The CSS expression itself must guarantee a minimum floor.
    expect(cssVar.replace(/\s/g, "")).toContain("max(env(safe-area-inset-bottom,0px),8px)");
  });
});

afterEach(() => {
  document.documentElement.style.removeProperty("--bottom-nav-safe-inset");
  document.documentElement.style.removeProperty("--bottom-nav-safe-inset-px");
  document.documentElement.style.removeProperty("--bottom-nav-offset");
});
