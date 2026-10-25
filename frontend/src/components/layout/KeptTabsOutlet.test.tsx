import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

const mounts: Record<string, number> = {};
let homeNavigate: ReturnType<typeof useNavigate> | null = null;
function Page({ name }: { name: string }) {
  const [count] = useState(() => { mounts[name] = (mounts[name] ?? 0) + 1; return mounts[name]; });
  const loc = useLocation();
  const navigate = useNavigate();
  if (name === "home") homeNavigate = navigate;
  return <div>{name} mount {count} at {loc.pathname}</div>;
}
vi.mock("@/lib/lazyWithRetry", () => ({
  lazyWithRetry: (factory: () => Promise<{ default: unknown }>) => {
    const src = String(factory);
    const name = src.includes("HomePage") ? "home" : src.includes("MessagesPage") ? "messages" : src.includes("EventsPage") ? "events" : "media";
    return () => <Page name={name} />;
  },
}));
import { KeptTabsOutlet } from "./KeptTabsOutlet";

let go: ReturnType<typeof useNavigate>;
let current = "";
function Probe() { go = useNavigate(); const l = useLocation(); useEffect(() => { current = l.pathname; }); return null; }

describe("kept bottom tabs", () => {
  it("shows a revisited tab without remounting and keeps hidden tabs from navigating", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Probe />
        <Routes><Route element={<KeptTabsOutlet ownerId="p1" prewarm={false} />}>
          <Route path="/" element={null} /><Route path="/messages" element={null} />
          <Route path="/teams/:id" element={<div>team page</div>} />
        </Route></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("home mount 1 at /")).toBeTruthy();
    act(() => { go("/messages"); });
    expect(screen.getByText("messages mount 1 at /messages")).toBeTruthy();
    // Hidden Home still sees its own location and cannot change the URL.
    expect(screen.getByText("home mount 1 at /")).toBeTruthy();
    act(() => { homeNavigate?.("/teams/x"); });
    expect(current).toBe("/messages");
    act(() => { go("/"); });
    expect(mounts.home).toBe(1);
    act(() => { go("/teams/1"); });
    expect(screen.getByText("team page")).toBeTruthy();
  });
});
