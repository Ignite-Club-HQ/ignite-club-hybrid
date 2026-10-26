import React, { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { TabPagePlaceholder } from "./TabPagePlaceholder";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("immediate destination navigation", () => {
  it("opens the locked club destination immediately during a stalled download and allows Back", () => {
    const Pending = React.lazy(() => new Promise<{ default: React.ComponentType }>(() => {}));
    render(<BrowserRouter useTransitions={false}>
      <Link to="/clubs/group2/upgrade" state={{ upgradeClubLabel: { id: "group2", name: "Group 2 test" } }}>Locked club folder</Link>
      <Suspense fallback={<TabPagePlaceholder />}><Routes>
        <Route path="/" element={<div>Vault folders</div>} />
        <Route path="/clubs/:clubId/upgrade" element={<Pending />} />
      </Routes></Suspense>
    </BrowserRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Locked club folder" }));
    expect(window.location.pathname).toBe("/clubs/group2/upgrade");
    expect(screen.getByRole("button", { name: "Go back" })).toBeEnabled();
    // Pending authorization must not expose payment controls.
    expect(screen.queryByRole("button", { name: /subscribe|purchase|trial/i })).not.toBeInTheDocument();
  });
  it("commits the tapped destination before its lazy module resolves and allows another tap", async () => {
    let finish: ((module: { default: React.ComponentType }) => void) | undefined;
    const Pending = React.lazy(() => new Promise<{ default: React.ComponentType }>((resolve) => { finish = resolve; }));
    function Shell() {
      const location = useLocation();
      return <>
        <Link to="/messages">Messages tab</Link><Link to="/events">Schedule tab</Link>
        <output data-testid="current-path">{location.pathname}</output>
        <Suspense fallback={<TabPagePlaceholder />}>
          <Routes>
            <Route path="/" element={<div>Home content</div>} />
            <Route path="/messages" element={<Pending />} />
            <Route path="/events" element={<div>Saved schedule content</div>} />
          </Routes>
        </Suspense>
      </>;
    }
    render(<BrowserRouter useTransitions={false}><Shell /></BrowserRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Messages tab" }));
    expect(screen.getByTestId("current-path")).toHaveTextContent("/messages");
    expect(screen.getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Schedule tab" }));
    expect(screen.getByText("Saved schedule content")).toBeInTheDocument();
    await act(async () => { finish?.({ default: () => <div>Fresh inbox content</div> }); });
    expect(screen.getByTestId("current-path")).toHaveTextContent("/events");
    fireEvent.click(screen.getByRole("link", { name: "Messages tab" }));
    expect(await screen.findByText("Fresh inbox content")).toBeInTheDocument();
  });
});