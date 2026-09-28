/**
 * Regression tests for AccountRecoveryBanner.
 *
 * Covers the session-validation guard added for the recover-account flow:
 *   - Missing/expired session must not invoke `recover-account`.
 *   - Missing session keeps the warning visible and does not call
 *     `onRecovered`.
 *   - Backend failure does not report success.
 *   - Successful recovery clears the warning exactly once.
 *   - Controls are disabled while pending and restored after failure.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

// ---- toast mock -----------------------------------------------------------
const toastFn = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

// ---- supabase mock --------------------------------------------------------
let getSessionResult: { data: { session: any }; error: any } = {
  data: { session: { access_token: "valid-token" } },
  error: null,
};
const invokeFn = vi.fn();

// Simulated `from().select().eq().single()` — returns a scheduled deletion so
// the banner renders.
const selectChain = {
  eq: () => selectChain,
  single: async () => ({
    data: {
      scheduled_deletion_at: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    },
    error: null,
  }),
  select: () => selectChain,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve(getSessionResult),
    },
    functions: { invoke: (...args: any[]) => invokeFn(...args) },
    from: () => selectChain,
  },
}));

import { AccountRecoveryBanner } from "./AccountRecoveryBanner";

const onRecovered = vi.fn();

beforeEach(() => {
  toastFn.mockReset();
  invokeFn.mockReset();
  onRecovered.mockReset();
  getSessionResult = {
    data: { session: { access_token: "valid-token" } },
    error: null,
  };
});

async function renderBanner() {
  render(<AccountRecoveryBanner userId="user-1" onRecovered={onRecovered} />);
  // Wait for the banner (post async status check) to appear.
  await screen.findByRole("button", { name: /recover my account/i });
}

describe("AccountRecoveryBanner — session validation", () => {
  it("valid session sends the exact bearer token", async () => {
    invokeFn.mockResolvedValue({ data: { success: true }, error: null });
    await renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /recover my account/i }));
    await waitFor(() => expect(invokeFn).toHaveBeenCalledTimes(1));
    const [, opts] = invokeFn.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer valid-token");
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("missing session stops before backend call and keeps warning", async () => {
    getSessionResult = { data: { session: null }, error: null };
    await renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /recover my account/i }));
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(invokeFn).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
    expect(
      screen.getByText(/account scheduled for deletion/i)
    ).toBeInTheDocument();
  });

  it("session lookup error stops before backend call", async () => {
    getSessionResult = { data: { session: null }, error: new Error("nope") };
    await renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /recover my account/i }));
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(invokeFn).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("undefined access token is rejected", async () => {
    getSessionResult = { data: { session: { access_token: undefined } }, error: null };
    await renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /recover my account/i }));
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(invokeFn).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("empty and whitespace access tokens are rejected", async () => {
    for (const bad of ["", "   "]) {
      invokeFn.mockReset();
      onRecovered.mockReset();
      getSessionResult = { data: { session: { access_token: bad } }, error: null };
      const { unmount } = render(
        <AccountRecoveryBanner userId="user-1" onRecovered={onRecovered} />
      );
      const btn = await screen.findByRole("button", { name: /recover my account/i });
      fireEvent.click(btn);
      await waitFor(() => expect(toastFn).toHaveBeenCalled());
      expect(invokeFn).not.toHaveBeenCalled();
      expect(onRecovered).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("backend failure does not clear warning or call onRecovered", async () => {
    invokeFn.mockResolvedValue({ data: null, error: { message: "boom" } });
    await renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /recover my account/i }));
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );
    expect(onRecovered).not.toHaveBeenCalled();
    expect(
      screen.getByText(/account scheduled for deletion/i)
    ).toBeInTheDocument();
    // Button should be re-enabled for retry.
    expect(
      (screen.getByRole("button", { name: /recover my account/i }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("prevents duplicate recovery requests while one is pending", async () => {
    let resolveInvoke: (v: any) => void = () => {};
    invokeFn.mockImplementation(
      () => new Promise((r) => { resolveInvoke = r; })
    );
    await renderBanner();
    const btn = screen.getByRole("button", { name: /recover my account/i });
    fireEvent.click(btn);
    // Yield to the async token-check microtasks so the recovering state
    // has propagated before the follow-up clicks fire.
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(invokeFn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveInvoke({ data: { success: true }, error: null });
    });
  });

  it("successful recovery clears the warning exactly once", async () => {
    invokeFn.mockResolvedValue({ data: { success: true }, error: null });
    await renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /recover my account/i }));
    await waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.queryByText(/account scheduled for deletion/i)
      ).not.toBeInTheDocument()
    );
  });
});
