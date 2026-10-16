/**
 * Regression tests for ScheduledMessagesBanner — verifies that rapid clicks
 * on the "Cancel message" confirmation button send exactly one cancellation
 * request, that the confirm control is disabled + relabelled while the
 * request is pending, and that failures preserve the selection so the user
 * can deliberately retry.
 *
 * The scheduled-message hook is mocked so these tests exercise the shared
 * confirmation UI contract; provider transport is covered by hook tests.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const scheduledRow = {
  id: "sched-1",
  scheduled_for: new Date(Date.now() + 3_600_000).toISOString(),
  text: "Reminder: bring boots",
  image_url: null,
  recurrence: "none",
  chat_type: "team",
  team_id: "t1",
  status: "pending",
};
const scheduledMessageMocks = vi.hoisted(() => ({
  rows: [] as any[],
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/hooks/useScheduledMessages", () => ({
  useThreadScheduledMessages: () => ({
    data: scheduledMessageMocks.rows,
    isError: scheduledMessageMocks.isError,
    isFetching: scheduledMessageMocks.isFetching,
    refetch: scheduledMessageMocks.refetch,
  }),
  useCancelScheduledMessage: () => ({
    mutateAsync: (...args: unknown[]) => scheduledMessageMocks.cancel(...args),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

// Silence sonner in tests but keep call-count assertions.
const successSpy = vi.fn();
const errorSpy = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => successSpy(m), error: (m: string) => errorSpy(m) },
}));

// Skip the ScheduleMessageDialog subtree — it's unrelated and pulls in
// heavy dependencies for tests focused on the cancel path. Mock via BOTH
// the aliased and relative specifiers because Vitest treats them as
// distinct module IDs when resolving vi.mock.
vi.mock("./ScheduleMessageDialog", () => ({
  ScheduleMessageDialog: () => null,
  localTimezoneLabel: () => "UTC",
}));
vi.mock("@/components/chat/ScheduleMessageDialog", () => ({
  ScheduleMessageDialog: () => null,
  localTimezoneLabel: () => "UTC",
}));

// ---- imports under test -----------------------------------------------

import { ScheduledMessagesBanner } from "./ScheduledMessagesBanner";

// ---- helpers ----------------------------------------------------------

function renderBanner() {
  
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ScheduledMessagesBanner target={{ chat_type: "team", team_id: "t1" }} />
    </QueryClientProvider>,
  );
}

async function openConfirmDialog() {
  renderBanner();
  // Give React Query one tick to resolve the mocked read query so the
  // banner mounts before we start querying it.
  await new Promise((r) => setTimeout(r, 50));
  // Expand the banner, then click the row's cancel (X) button.
  const expandBtn = await screen.findByRole(
    "button",
    { name: /1 scheduled message/i },
    { timeout: 3000 },
  );
  fireEvent.click(expandBtn);
  const rowCancel = await screen.findByRole("button", {
    name: /^Cancel scheduled message$/i,
  });
  fireEvent.click(rowCancel);
  return await screen.findByRole("alertdialog");
}

const getConfirmButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: /^(Cancel message|Cancelling…)$/i });

beforeEach(() => {
  scheduledMessageMocks.rows = [scheduledRow];
  scheduledMessageMocks.isError = false;
  scheduledMessageMocks.isFetching = false;
  scheduledMessageMocks.refetch.mockReset();
  scheduledMessageMocks.cancel.mockReset();
  successSpy.mockReset();
  errorSpy.mockReset();
});

afterEach(() => cleanup());

// ---- tests ------------------------------------------------------------

describe("ScheduledMessagesBanner — confirm cancellation flow", () => {
  it("one confirmation click sends exactly one mutation", async () => {
    scheduledMessageMocks.cancel.mockResolvedValueOnce(undefined);
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(scheduledMessageMocks.cancel).toHaveBeenCalledTimes(1));
    expect(scheduledMessageMocks.cancel).toHaveBeenCalledWith("sched-1");
  });

  it("must prevent duplicate cancellation requests while the first is pending", async () => {
    // Never-resolving invoke so the request stays pending across both clicks.
    let resolveInvoke!: (v: any) => void;
    scheduledMessageMocks.cancel.mockImplementationOnce(
      () => new Promise((r) => { resolveInvoke = r; }),
    );
    const dialog = await openConfirmDialog();
    const btn = getConfirmButton(dialog);
    // Two rapid synchronous clicks — the second must be swallowed.
    fireEvent.click(btn);
    fireEvent.click(btn);
    // Wait for the async mutationFn microtask to invoke the Edge Function.
    await waitFor(() => expect(scheduledMessageMocks.cancel).toHaveBeenCalledTimes(1));
    // Give any (incorrectly-permitted) second invocation a chance to fire
    // so this assertion doesn't false-pass on ordering alone.
    await new Promise((r) => setTimeout(r, 50));
    expect(scheduledMessageMocks.cancel).toHaveBeenCalledTimes(1);
    // Cleanly resolve so React Query doesn't leak a pending mutation.
    resolveInvoke(undefined);
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
  });

  it("disables the confirm button and relabels it to Cancelling… while pending", async () => {
    let resolveInvoke!: (v: any) => void;
    scheduledMessageMocks.cancel.mockImplementationOnce(
      () => new Promise((r) => { resolveInvoke = r; }),
    );
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => {
      const b = within(dialog).getByRole("button", { name: /Cancelling…/i });
      expect(b).toBeDisabled();
    });
    resolveInvoke(undefined);
  });

  it("reports success exactly once and closes the dialog", async () => {
    scheduledMessageMocks.cancel.mockResolvedValueOnce(undefined);
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reports failure exactly once and keeps the dialog open for retry", async () => {
    scheduledMessageMocks.cancel.mockRejectedValueOnce(new Error("network"));
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    // Dialog stays open + button is re-enabled and relabelled for retry.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    const retryBtn = within(screen.getByRole("alertdialog")).getByRole("button", {
      name: /^Cancel message$/i,
    });
    expect(retryBtn).not.toBeDisabled();
    expect(successSpy).not.toHaveBeenCalled();
  });

  it("a failed cancellation can be retried and reports success on the second attempt", async () => {
    scheduledMessageMocks.cancel
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(getConfirmButton(screen.getByRole("alertdialog")));
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
    expect(scheduledMessageMocks.cancel).toHaveBeenCalledTimes(2);
  });

  it("only the selected scheduled-message ID is submitted", async () => {
    scheduledMessageMocks.cancel.mockResolvedValueOnce(undefined);
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(scheduledMessageMocks.cancel).toHaveBeenCalledTimes(1));
    expect(scheduledMessageMocks.cancel).toHaveBeenCalledWith("sched-1");
  });

  it("a stale click after the dialog closes cannot submit another request", async () => {
    scheduledMessageMocks.cancel.mockResolvedValueOnce(undefined);
    const dialog = await openConfirmDialog();
    const btn = getConfirmButton(dialog);
    fireEvent.click(btn);
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
    // Dialog has closed — the resolved button ref no longer belongs to an
    // open dialog. Clicking it again must not resurrect a mutation.
    fireEvent.click(btn);
    // Still exactly one invocation.
    expect(scheduledMessageMocks.cancel).toHaveBeenCalledTimes(1);
  });
});
