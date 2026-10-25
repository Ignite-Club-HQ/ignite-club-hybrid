import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

const prefetch = vi.hoisted(() => ({ warm: vi.fn(), route: vi.fn() }));
vi.mock("@/lib/routePrefetch", () => ({ warmMainRoutes: prefetch.warm, prefetchRoute: prefetch.route }));
vi.mock("@/hooks/useNavMessagesBadgeCount", () => ({ useNavMessagesBadgeCount: () => 0 }));
vi.mock("@/hooks/useKeyboardOpen", () => ({ useKeyboardOpen: () => false }));
vi.mock("@/hooks/useNativeKeyboardHeight", () => ({ useNativeKeyboardHeight: () => 0 }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Bottom navigation page warmup", () => {
  it("starts idle page warmup without waiting for the first tab tap", () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>);
    expect(prefetch.warm).toHaveBeenCalledTimes(1);
    expect(prefetch.route).not.toHaveBeenCalled();
  });
  it("warms a focused tab and navigates immediately on click without waiting for prefetch", () => {
    render(<MemoryRouter><BottomNav /><Routes><Route path="/messages" element={<div>Inbox ready</div>} /></Routes></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Messages" });
    fireEvent.focus(link);
    expect(prefetch.route).toHaveBeenCalledWith("/messages");
    fireEvent.click(link);
    expect(screen.getByText("Inbox ready")).toBeDefined();
  });
});