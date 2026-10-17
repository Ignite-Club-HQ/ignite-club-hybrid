import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import React from "react";

const rpcMock = vi.fn();
const resolveShortCodeMock = vi.fn();
const icpMode = process.env.IGNITE_TEST_BACKEND_MODE === "icp";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => (icpMode ? "icp" : "supabase") }));
vi.mock("@/assets/ignite-icon.png", () => ({ default: "icon.png" }));
vi.mock("@/live/features/club", () => ({
  resolveLiveInviteShortCode: (...args: unknown[]) => resolveShortCodeMock(...args),
}));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({ name: "test-target" }) }));

import ShortInviteRedirect from "./ShortInviteRedirect";

function renderAt(path: string) {
  const url = new URL(path, "http://localhost");
  if (!url.searchParams.has("backend")) url.searchParams.set("backend", "supabase");
  const entry = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", entry);
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/i/:code" element={<ShortInviteRedirect />} />
        <Route path="/join/p/:token" element={<div data-testid="joined">joined</div>} />
        <Route path="/auth" element={<div data-testid="auth">auth</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  resolveShortCodeMock.mockReset();
});

describe.runIf(!icpMode)("ShortInviteRedirect Supabase RPC", () => {
  it("navigates to /join/p/<token> when the RPC returns a token", async () => {
    rpcMock.mockResolvedValue({ data: "tok-123", error: null });
    renderAt("/i/abc");
    await waitFor(() => expect(screen.getByTestId("joined")).toBeInTheDocument());
  });

  it("navigates to /auth on RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "no" } });
    renderAt("/i/abc");
    await waitFor(() => expect(screen.getByTestId("auth")).toBeInTheDocument());
  });

  it("encodes tokens containing reserved URL characters into one segment", async () => {
    rpcMock.mockResolvedValue({ data: "a/b?c#d", error: null });
    const { container } = renderAt("/i/abc");
    // The Navigate happens synchronously after state settles — assert the
    // rendered route resolved to /join/p/... by checking the joined element.
    await waitFor(() => expect(screen.getByTestId("joined")).toBeInTheDocument());
    // No leakage of decoded path segments into other routes.
    expect(container.querySelector('[data-testid="auth"]')).toBeNull();
  });

  it("ignores a late response for a superseded short code", async () => {
    // First call is slow, second call resolves fast.
    let resolveFirst: (v: unknown) => void = () => {};
    rpcMock.mockImplementationOnce(
      () => new Promise((r) => { resolveFirst = r; }),
    );
    rpcMock.mockResolvedValueOnce({ data: "tok-second", error: null });

    // Render at /i/first then unmount and render at /i/second (simulates code change).
    const first = renderAt("/i/first");
    first.unmount();
    renderAt("/i/second");
    await waitFor(() => expect(screen.getByTestId("joined")).toBeInTheDocument());

    // Late response for the unmounted first code MUST NOT throw or navigate.
    expect(() => resolveFirst({ data: "tok-first", error: null })).not.toThrow();
  });
});

describe.runIf(icpMode)("ShortInviteRedirect ICP boundary", () => {
  it("rejects an unknown on-chain code without resolving a Supabase short code", async () => {
    resolveShortCodeMock.mockRejectedValue(new Error("Invite not found"));
    renderAt("/i/abc");
    expect(await screen.findByTestId("auth")).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("joined")).not.toBeInTheDocument();
  });
  it("resolves an on-chain code anonymously and opens the invite without Supabase", async () => {
    resolveShortCodeMock.mockResolvedValue("invite-123");
    renderAt("/i/abc");
    expect(await screen.findByTestId("joined")).toBeInTheDocument();
    expect(resolveShortCodeMock).toHaveBeenCalledWith({
      identity: expect.objectContaining({ getPrincipal: expect.any(Function) }),
      target: { name: "test-target" },
    }, "abc");
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("returns to sign-in instead of spinning forever when no invite is returned", async () => {
    resolveShortCodeMock.mockResolvedValue(null);
    renderAt("/i/missing");
    expect(await screen.findByTestId("auth")).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
