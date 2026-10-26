import React, { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { TabPagePlaceholder } from "./TabPagePlaceholder";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("immediate destination navigation", () => {
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