import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ unreadMessagesCount: 0, user: null }),
}));
vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ activeClubFilter: null }),
}));
// Keyboard is reported open (stuck height); the nav may only hide when a
// *visible* editable element is focused.
vi.mock("@/hooks/useKeyboardOpen", () => ({ useKeyboardOpen: () => true }));
vi.mock("@/hooks/useNativeKeyboardHeight", () => ({ useNativeKeyboardHeight: () => 300 }));
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

const navTransform = () =>
  (document.querySelector('nav[aria-label="Main navigation"]') as HTMLElement)?.style.transform;

describe("BottomNav with keyboard open and hidden-tab focus", () => {
  it("stays visible when the focused input lives in a hidden kept tab", async () => {
    // Simulate a kept background tab: mounted, display:none, aria-hidden,
    // with its composer input still focused.
    const hiddenTab = document.createElement("div");
    hiddenTab.className = "hidden";
    hiddenTab.setAttribute("aria-hidden", "true");
    const input = document.createElement("input");
    hiddenTab.appendChild(input);
    document.body.appendChild(hiddenTab);
    input.focus();

    renderNav();

    await waitFor(() => expect(navTransform()).toBe("translate3d(0,0,0)"));
    hiddenTab.remove();
  });

  it("hides when a visible editable element is focused", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    renderNav();

    await waitFor(() => expect(navTransform()).toBe("translateY(100%)"));
    input.remove();
  });
});
