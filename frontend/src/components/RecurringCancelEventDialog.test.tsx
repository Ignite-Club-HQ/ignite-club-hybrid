/**
 * Regression tests for RecurringCancelEventDialog — verifies the fail-closed
 * behaviour when recipient discovery fails: both single-occurrence and
 * entire-series cancellation remain available but push notification delivery
 * is force-disabled. On successful discovery the callbacks receive the
 * user's push selection unchanged.
 *
 * These tests fully mock @/integrations/supabase/client — no database or
 * hosted service is contacted.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { RecurringCancelEventDialog } from "./RecurringCancelEventDialog";

// ---- supabase mock ----------------------------------------------------

type TableResp = { data: unknown; error: { message: string } | null };
const tableResponses: Record<string, TableResp> = {};

const makeChain = (table: string) => {
  const resolve = () => Promise.resolve(tableResponses[table] ?? { data: [], error: null });
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
  eventTitle: "Weekly Training",
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
});

// ---- tests ------------------------------------------------------------

describe("RecurringCancelEventDialog — fail-closed on recipient lookup failure", () => {
  it("counts members and enables push when recipient lookup succeeds", async () => {
    setUserRoles([{ user_id: "u1" }, { user_id: "u2" }]);
    render(
      <RecurringCancelEventDialog
        {...baseProps}
        onSingleAction={vi.fn()}
        onSeriesAction={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/2 members will be notified/i)).toBeInTheDocument()
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeDisabled();
    expect(checkbox).toHaveAttribute("data-state", "checked");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("must fail closed on push delivery when series recipient discovery fails — single button", async () => {
    setUserRoles(null, { message: "boom" });
    const onSingleAction = vi.fn();
    const onSeriesAction = vi.fn();
    render(
      <RecurringCancelEventDialog
        {...baseProps}
        onSingleAction={onSingleAction}
        onSeriesAction={onSeriesAction}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("data-state", "unchecked");
    expect(checkbox).toBeDisabled();
    expect(screen.queryByText(/members will be notified/i)).toBeNull();

    const singleBtn = screen.getByRole("button", { name: /Cancel This/i });
    expect(singleBtn).not.toBeDisabled();
    fireEvent.click(singleBtn);
    expect(onSingleAction).toHaveBeenCalledTimes(1);
    expect(onSingleAction).toHaveBeenCalledWith(undefined, false);
    expect(onSeriesAction).not.toHaveBeenCalled();
  });

  it("must fail closed on push delivery when series recipient discovery fails — series button", async () => {
    setUserRoles(null, { message: "boom" });
    const onSingleAction = vi.fn();
    const onSeriesAction = vi.fn();
    render(
      <RecurringCancelEventDialog
        {...baseProps}
        onSingleAction={onSingleAction}
        onSeriesAction={onSeriesAction}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const seriesBtn = screen.getByRole("button", { name: /Cancel Entire Series/i });
    expect(seriesBtn).not.toBeDisabled();
    fireEvent.click(seriesBtn);
    expect(onSeriesAction).toHaveBeenCalledTimes(1);
    expect(onSeriesAction).toHaveBeenCalledWith(undefined, false);
    expect(onSingleAction).not.toHaveBeenCalled();
  });

  it("trims the custom message and forwards it with push=false when lookup fails", async () => {
    setUserRoles(null, { message: "boom" });
    const onSingleAction = vi.fn();
    render(
      <RecurringCancelEventDialog
        {...baseProps}
        onSingleAction={onSingleAction}
        onSeriesAction={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/Add a reason/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  cancelled  " } });
    fireEvent.click(screen.getByRole("button", { name: /Cancel This/i }));
    expect(onSingleAction).toHaveBeenCalledWith("cancelled", false);
  });

  it("a successful retry restores normal recipient count and push selection", async () => {
    setUserRoles(null, { message: "boom" });
    const onSingleAction = vi.fn();
    const { rerender } = render(
      <RecurringCancelEventDialog
        {...baseProps}
        onSingleAction={onSingleAction}
        onSeriesAction={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    setUserRoles([{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }, { user_id: "u1" }]);
    rerender(
      <RecurringCancelEventDialog
        {...baseProps}
        open={false}
        onSingleAction={onSingleAction}
        onSeriesAction={vi.fn()}
      />
    );
    rerender(
      <RecurringCancelEventDialog
        {...baseProps}
        onSingleAction={onSingleAction}
        onSeriesAction={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/3 members will be notified/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole("alert")).toBeNull();

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeDisabled();
    expect(checkbox).toHaveAttribute("data-state", "checked");

    fireEvent.click(screen.getByRole("button", { name: /Cancel This/i }));
    expect(onSingleAction).toHaveBeenLastCalledWith(undefined, true);
  });
});
