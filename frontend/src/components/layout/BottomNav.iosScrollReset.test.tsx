import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock Capacitor as native iOS so the iOS layout-stability branch is active.
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
}));

// Mock auth + theme hooks so BottomNav can render without a real backend.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ unreadMessagesCount: 0, user: null }),
}));
vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ activeClubFilter: null }),
}));
vi.mock("@/hooks/useKeyboardOpen", () => ({
  useKeyboardOpen: () => false,
}));
vi.mock("@/hooks/useNativeKeyboardHeight", () => ({
  useNativeKeyboardHeight: () => 0,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ in: () => Promise.resolve({ count: 0 }) }),
          }),
        }),
      }),
    }),
  },
}));

import { BottomNav } from "./BottomNav";

function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button data-testid="go-thread" onClick={() => navigate("/messages/dm/abc")}>
        thread
      </button>
      <button data-testid="go-home" onClick={() => navigate("/")}>
        home
      </button>
      <BottomNav />
    </>
  );
}

describe("BottomNav iOS scroll reset regression", () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    // Simulate the iOS post-thread state: window left scrolled down.
    window.scrollY = 200 as unknown as number;
    document.documentElement.scrollTop = 200;
    document.body.scrollTop = 200;
  });

  afterEach(() => {
    scrollSpy.mockRestore();
    vi.useRealTimers();
  });

  it("forces window scroll back to top across the settle window after returning from a chat thread", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/messages/dm/abc"]}>
          <Routes>
            <Route path="*" element={<Harness />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    scrollSpy.mockClear();

    // Navigate back to home — mimics returning from the chat thread.
    act(() => {
      (document.querySelector('[data-testid="go-home"]') as HTMLButtonElement).click();
    });

    // Synchronous reset on route change.
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
    const initialCalls = scrollSpy.mock.calls.length;

    // Flush rAF + 120ms + 360ms settle window.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Each settle tick must reset back to top — at least 3 more calls (rAF, 120ms, 360ms).
    expect(scrollSpy.mock.calls.length).toBeGreaterThanOrEqual(initialCalls + 2);
    for (const call of scrollSpy.mock.calls) {
      expect(call[0]).toEqual({ top: 0, left: 0, behavior: "auto" });
    }

    // Document scroll positions are zeroed so the fixed nav can't sit clipped under the home indicator.
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  });
});
