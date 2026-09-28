/**
 * Regression tests for CancelEventConfirmDialog — verifies the fail-closed
 * behaviour when recipient discovery fails: cancellation stays available but
 * push notification delivery is force-disabled and the callback receives
 * `false` for the push flag. On successful discovery the dialog behaves as
 * before.
 *
 * These tests fully mock @/integrations/supabase/client — no database or
 * hosted service is contacted.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CancelEventConfirmDialog } from "./CancelEventConfirmDialog";

// ---- supabase mock ----------------------------------------------------

type TableResp = { data: unknown; error: { message: string } | null };
const tableResponses: Record<string, TableResp> = {};
const tableCalls: Record<string, number> = {};

const makeChain = (table: string) => {
  const resolve = () => {
    tableCalls[table] = (tableCalls[table] ?? 0) + 1;
    return Promise.resolve(tableResponses[table] ?? { data: [], error: null });
  };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    maybeSingle: () => resolve(),
    single: () => resolve(),
    then: (onF: any, onR: any) => resolve().then(onF, onR),
  };
  return chain;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeChain(table),
  },
}));

vi.mock("@/hooks/useNativeKeyboardBottomInset", () => ({
  useNativeKeyboardBottomInset: () => 0,
}));

// ---- helpers ----------------------------------------------------------

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  eventId: "e1",
  eventTitle: "Test Event",
  teamId: "team-1",
  clubId: "club-1",
  eventType: "training" as string | null,
};

const setUserRoles = (data: unknown, error: any = null) => {
  tableResponses["user_roles"] = { data, error };
};

beforeEach(() => {
  cleanup();
  Object.keys(tableResponses).forEach((k) => delete tableResponses[k]);
  Object.keys(tableCalls).forEach((k) => delete tableCalls[k]);
});

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---- tests ------------------------------------------------------------

describe("CancelEventConfirmDialog — fail-closed on recipient lookup failure", () => {
  it("counts members and enables push when recipient lookup succeeds", async () => {
    setUserRoles([{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u1" }]);
    const onConfirm = vi.fn();
    render(<CancelEventConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    await waitFor(() =>
      expect(screen.getByText(/2 members will be notified\./i)).toBeInTheDocument()
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeDisabled();
    expect(checkbox).toHaveAttribute("data-state", "checked");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("must fail closed on push delivery when recipient discovery fails", async () => {
    setUserRoles(null, { message: "boom" });
    const onConfirm = vi.fn();
    render(<CancelEventConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // Warning is shown, checkbox is unchecked + disabled, count is NOT displayed.
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be verified/i);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("data-state", "unchecked");
    expect(checkbox).toBeDisabled();
    expect(screen.queryByText(/members will be notified/i)).toBeNull();
    expect(screen.queryByText(/0 members? will be notified/i)).toBeNull();

    // Cancellation button remains enabled and passes `false` for push.
    const cancelBtn = screen.getByRole("button", { name: /^Cancel (Event|Training)/i });
    expect(cancelBtn).not.toBeDisabled();
    fireEvent.click(cancelBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(undefined, false);
  });

  it("passes false for push even if user had checked it before lookup errored", async () => {
    // First render succeeds — user leaves push checked (default).
    setUserRoles([{ user_id: "u1" }]);
    const onConfirm = vi.fn();
    const { rerender } = render(
      <CancelEventConfirmDialog {...baseProps} onConfirm={onConfirm} />
    );
    await waitFor(() =>
      expect(screen.getByText(/1 member will be notified/i)).toBeInTheDocument()
    );

    // Simulate reopen with a failing lookup.
    setUserRoles(null, { message: "network" });
    rerender(
      <CancelEventConfirmDialog {...baseProps} open={false} onConfirm={onConfirm} />
    );
    rerender(<CancelEventConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const cancelBtn = screen.getByRole("button", { name: /^Cancel (Event|Training)/i });
    fireEvent.click(cancelBtn);
    expect(onConfirm).toHaveBeenLastCalledWith(undefined, false);
  });

  it("trims custom message and forwards it with push=false on failed lookup", async () => {
    setUserRoles(null, { message: "boom" });
    const onConfirm = vi.fn();
    render(<CancelEventConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/Add a reason/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  weather  " } });

    fireEvent.click(screen.getByRole("button", { name: /^Cancel (Event|Training)/i }));
    expect(onConfirm).toHaveBeenCalledWith("weather", false);
  });

  it("a successful retry (reopen) restores normal recipient count and push selection", async () => {
    setUserRoles(null, { message: "boom" });
    const onConfirm = vi.fn();
    const { rerender } = render(
      <CancelEventConfirmDialog {...baseProps} onConfirm={onConfirm} />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // Reopen with a healthy response.
    setUserRoles([{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }]);
    rerender(
      <CancelEventConfirmDialog {...baseProps} open={false} onConfirm={onConfirm} />
    );
    rerender(<CancelEventConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    await waitFor(() =>
      expect(screen.getByText(/3 members will be notified/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole("alert")).toBeNull();

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeDisabled();
    expect(checkbox).toHaveAttribute("data-state", "checked");

    fireEvent.click(screen.getByRole("button", { name: /^Cancel (Event|Training)/i }));
    expect(onConfirm).toHaveBeenCalledWith(undefined, true);
  });

  it("does not display '0 members will be notified' after a failed lookup", async () => {
    setUserRoles(null, { message: "boom" });
    render(<CancelEventConfirmDialog {...baseProps} onConfirm={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    await flush();
    expect(screen.queryByText(/0 members? will be notified/i)).toBeNull();
  });
});
