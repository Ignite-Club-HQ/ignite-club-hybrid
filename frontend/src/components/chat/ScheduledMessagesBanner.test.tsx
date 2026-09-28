/**
 * Regression tests for ScheduledMessagesBanner — verifies that rapid clicks
 * on the "Cancel message" confirmation button send exactly one cancellation
 * request, that the confirm control is disabled + relabelled while the
 * request is pending, and that failures preserve the selection so the user
 * can deliberately retry.
 *
 * The Supabase client is fully mocked (thread fetch + cancel mutation).
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

// ---- Supabase mock ----------------------------------------------------

// Read chain returns one pending scheduled message so the banner renders.
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

let readResponse: { data: unknown; error: unknown } = { data: [scheduledRow], error: null };

function makeReadChain() {
  const chain: any = {};
  for (const m of ["select", "eq", "in", "is", "order", "not"]) chain[m] = () => chain;
  chain.then = (onF: any, onR: any) => Promise.resolve(readResponse).then(onF, onR);
  return chain;
}

// invokeSpy is the shared handle every test uses to observe / configure the
// cancel Edge Function invocation.
const invokeSpy = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: any[]) => invokeSpy(...a) },
    from: () => makeReadChain(),
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
  },
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
  invokeSpy.mockReset();
  successSpy.mockReset();
  errorSpy.mockReset();
  readResponse = { data: [scheduledRow], error: null };
});

afterEach(() => cleanup());

// ---- tests ------------------------------------------------------------

describe("ScheduledMessagesBanner — confirm cancellation flow", () => {
  it("one confirmation click sends exactly one mutation", async () => {
    invokeSpy.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));
    expect(invokeSpy.mock.calls[0][1].body).toMatchObject({
      action: "cancel",
      id: "sched-1",
    });
  });

  it("must prevent duplicate cancellation requests while the first is pending", async () => {
    // Never-resolving invoke so the request stays pending across both clicks.
    let resolveInvoke!: (v: any) => void;
    invokeSpy.mockImplementationOnce(
      () => new Promise((r) => { resolveInvoke = r; }),
    );
    const dialog = await openConfirmDialog();
    const btn = getConfirmButton(dialog);
    // Two rapid synchronous clicks — the second must be swallowed.
    fireEvent.click(btn);
    fireEvent.click(btn);
    // Wait for the async mutationFn microtask to invoke the Edge Function.
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));
    // Give any (incorrectly-permitted) second invocation a chance to fire
    // so this assertion doesn't false-pass on ordering alone.
    await new Promise((r) => setTimeout(r, 50));
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    // Cleanly resolve so React Query doesn't leak a pending mutation.
    resolveInvoke({ data: { ok: true }, error: null });
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
  });

  it("disables the confirm button and relabels it to Cancelling… while pending", async () => {
    let resolveInvoke!: (v: any) => void;
    invokeSpy.mockImplementationOnce(
      () => new Promise((r) => { resolveInvoke = r; }),
    );
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => {
      const b = within(dialog).getByRole("button", { name: /Cancelling…/i });
      expect(b).toBeDisabled();
    });
    resolveInvoke({ data: { ok: true }, error: null });
  });

  it("reports success exactly once and closes the dialog", async () => {
    invokeSpy.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reports failure exactly once and keeps the dialog open for retry", async () => {
    invokeSpy.mockResolvedValueOnce({ data: null, error: { message: "network" } });
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
    invokeSpy
      .mockResolvedValueOnce({ data: null, error: { message: "network" } })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(getConfirmButton(screen.getByRole("alertdialog")));
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
    expect(invokeSpy).toHaveBeenCalledTimes(2);
  });

  it("only the selected scheduled-message ID is submitted", async () => {
    invokeSpy.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const dialog = await openConfirmDialog();
    fireEvent.click(getConfirmButton(dialog));
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));
    expect(invokeSpy.mock.calls[0][1].body.id).toBe("sched-1");
  });

  it("a stale click after the dialog closes cannot submit another request", async () => {
    invokeSpy.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const dialog = await openConfirmDialog();
    const btn = getConfirmButton(dialog);
    fireEvent.click(btn);
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
    // Dialog has closed — the resolved button ref no longer belongs to an
    // open dialog. Clicking it again must not resurrect a mutation.
    fireEvent.click(btn);
    // Still exactly one invocation.
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });
});
