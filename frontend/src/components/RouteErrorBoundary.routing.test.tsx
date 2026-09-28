import React, { Suspense } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isChunkLoadError,
  RouteErrorBoundary,
  tryRecoverFromChunkError,
} from "./RouteErrorBoundary";

const CHUNK_RELOAD_KEY = "ignite_chunk_reload_at";

function BrokenRoute({ error }: { error: Error }): never {
  throw error;
}

describe("route lazy-loading and recovery boundaries", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    "Failed to fetch dynamically imported module: /assets/Events-abc.js",
    "Importing a module script failed",
    "error loading dynamically imported module",
    "ChunkLoadError: Loading chunk 42 failed",
    "Loading CSS chunk 9 failed",
  ])("recognises a stale deployment asset failure: %s", (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it("does not misclassify ordinary application errors as stale chunks", () => {
    expect(isChunkLoadError(new Error("RLS denied"))).toBe(false);
    expect(isChunkLoadError(new Error("Cannot read properties of null"))).toBe(
      false,
    );
  });

  it("prevents repeated stale-chunk reloads inside the safety window", () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    expect(tryRecoverFromChunkError()).toBe(false);
  });

  it("never hard-reloads for a chunk failure while the browser is offline", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    expect(tryRecoverFromChunkError()).toBe(false);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it("retains one-shot stale-deployment recovery while the browser is online", () => {
    expect(tryRecoverFromChunkError()).toBe(true);
    expect(Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))).toBeGreaterThan(0);
  });

  it("surfaces a persistent chunk failure after the one-reload allowance is exhausted", () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));

    render(
      <RouteErrorBoundary>
        <BrokenRoute
          error={
            new Error(
              "Failed to fetch dynamically imported module: /assets/EventPage-old.js",
            )
          }
        />
      </RouteErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Failed to fetch dynamically imported module: /assets/EventPage-old.js",
        { selector: ".font-semibold" },
      ),
    ).toBeInTheDocument();
    expect(localStorage.getItem("ignite_last_route_error")).toContain(
      "EventPage-old.js",
    );
  });

  it("shows a recovery surface for an ordinary lazy-route rejection", async () => {
    const FailedLazyRoute = React.lazy(() =>
      Promise.reject(new Error("synthetic lazy route render failure")),
    );

    render(
      <RouteErrorBoundary>
        <Suspense fallback={<div>loading route</div>}>
          <FailedLazyRoute />
        </Suspense>
      </RouteErrorBoundary>,
    );

    expect(
      await screen.findByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("synthetic lazy route render failure", {
        selector: ".font-semibold",
      }),
    ).toBeInTheDocument();
  });

  it("clears pending push destinations before returning to the inbox", () => {
    sessionStorage.setItem("pendingPushNavigationUrl", "/events/broken");
    sessionStorage.setItem("ignite_pending_chat_jump_v1", "message-1");
    sessionStorage.setItem("ignite_pending_web_push_nav", "/messages/team-1");
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));

    render(
      <RouteErrorBoundary>
        <BrokenRoute error={new Error("persistent route failure")} />
      </RouteErrorBoundary>,
    );

    // jsdom cannot perform a full location replacement, but the synchronous
    // safety cleanup happens before that browser operation.
    fireEvent.click(screen.getByRole("button", { name: "Go to Inbox" }));

    expect(sessionStorage.getItem("pendingPushNavigationUrl")).toBeNull();
    expect(sessionStorage.getItem("ignite_pending_chat_jump_v1")).toBeNull();
    expect(sessionStorage.getItem("ignite_pending_web_push_nav")).toBeNull();
  });

  it("records route diagnostics without exposing an endless loading fallback", async () => {
    render(
      <RouteErrorBoundary>
        <BrokenRoute error={new Error("synthetic route crash")} />
      </RouteErrorBoundary>,
    );

    await waitFor(() => {
      expect(localStorage.getItem("ignite_last_route_error")).toContain(
        "synthetic route crash",
      );
    });
    expect(screen.queryByText("loading route")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeEnabled();
  });
});
