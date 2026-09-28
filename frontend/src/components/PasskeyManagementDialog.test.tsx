/**
 * Tests for PasskeyManagementDialog covering these required behaviours:
 *   1. Distinguish loading failures from an empty passkey list.
 *   2. Preserve Supabase error messages on failed deletion (and keep the
 *      passkey visible / cached / metadata intact).
 *   3. Never query user-scoped passkey data without an authenticated user.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- mocks -----------------------------------------------------------------
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

const removeAccountSpy = vi.fn();
const registerPasskeySpy = vi.fn();
vi.mock("@/hooks/usePasskey", () => ({
  usePasskey: () => ({
    registerPasskey: registerPasskeySpy,
    removeAccount: removeAccountSpy,
    storeCredentialsForNativeBiometric: vi.fn(),
    loading: false,
  }),
}));

let authUser: { id: string; email: string } | null = {
  id: "u1",
  email: "u@x.y",
};
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: authUser }),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

// Programmable supabase-from mock — each test sets what select/delete return.
let selectResult: { data: any[] | null; error: any } = { data: [], error: null };
let deleteResult: { error: any } = { error: null };

const orderMock = vi.fn(async () => selectResult);
const eqSelectMock = vi.fn(() => ({ order: orderMock }));
const selectMock = vi.fn(() => ({ eq: eqSelectMock }));

const deleteEq2Mock = vi.fn(async () => deleteResult);
const deleteEq1Mock = vi.fn(() => ({ eq: deleteEq2Mock }));
const deleteMock = vi.fn(() => ({ eq: deleteEq1Mock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: selectMock, delete: deleteMock }),
    auth: { signInWithPassword: vi.fn() },
  },
}));

// ---- SUT (imported after mocks) -------------------------------------------
import { PasskeyManagementDialog, getErrorMessage } from "./PasskeyManagementDialog";

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
};

beforeEach(() => {
  toastSpy.mockReset();
  removeAccountSpy.mockReset();
  registerPasskeySpy.mockReset();
  selectMock.mockClear();
  eqSelectMock.mockClear();
  orderMock.mockClear();
  deleteMock.mockClear();
  deleteEq1Mock.mockClear();
  deleteEq2Mock.mockClear();
  selectResult = { data: [], error: null };
  deleteResult = { error: null };
  authUser = { id: "u1", email: "u@x.y" };
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════
// getErrorMessage — helper contract
// ═══════════════════════════════════════════════════════════════════════════
describe("getErrorMessage helper", () => {
  it("returns message from Error instances", () => {
    expect(getErrorMessage(new Error("boom"), "fb")).toBe("boom");
  });
  it("returns message from plain Supabase-shaped objects", () => {
    expect(getErrorMessage({ message: "Delete denied" }, "fb")).toBe("Delete denied");
  });
  it("returns fallback when object has no message", () => {
    expect(getErrorMessage({ code: "42501" }, "fb")).toBe("fb");
  });
  it("returns fallback when message is an empty string", () => {
    expect(getErrorMessage({ message: "" }, "fb")).toBe("fb");
  });
  it("returns fallback when message is not a string", () => {
    expect(getErrorMessage({ message: 123 }, "fb")).toBe("fb");
  });
  it("returns fallback for null / undefined / primitives", () => {
    expect(getErrorMessage(null, "fb")).toBe("fb");
    expect(getErrorMessage(undefined, "fb")).toBe("fb");
    expect(getErrorMessage("raw string", "fb")).toBe("fb");
    expect(getErrorMessage(42, "fb")).toBe("fb");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Loading failures vs empty list
// ═══════════════════════════════════════════════════════════════════════════
describe("PasskeyManagementDialog — load-failure vs empty (defect #1)", () => {
  it("shows the empty state (and Add button) when query returns []", async () => {
    selectResult = { data: [], error: null };
    render(wrap(<PasskeyManagementDialog open={true} onOpenChange={() => {}} />));
    await waitFor(() =>
      expect(screen.getByText(/No passkeys registered yet/i)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /Add New Passkey/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error state with Retry (and hides Add + empty copy) when the query fails", async () => {
    selectResult = { data: null, error: { message: "RLS denied" } };
    render(wrap(<PasskeyManagementDialog open={true} onOpenChange={() => {}} />));
    await waitFor(() =>
      expect(screen.getByText(/Unable to load your passkeys/i)).toBeInTheDocument()
    );
    // Must NOT confuse users with the empty state.
    expect(screen.queryByText(/No passkeys registered yet/i)).not.toBeInTheDocument();
    // Add New Passkey must be hidden until retry succeeds.
    expect(screen.queryByRole("button", { name: /Add New Passkey/i })).not.toBeInTheDocument();
    // Retry button present.
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    // Must not leak backend text into the UI.
    expect(screen.queryByText(/RLS denied/)).not.toBeInTheDocument();
  });

  it("Retry re-runs the query and can transition into an empty state on success", async () => {
    selectResult = { data: null, error: { message: "boom" } };
    render(wrap(<PasskeyManagementDialog open={true} onOpenChange={() => {}} />));
    await waitFor(() =>
      expect(screen.getByText(/Unable to load your passkeys/i)).toBeInTheDocument()
    );
    const before = orderMock.mock.calls.length;
    selectResult = { data: [], error: null };
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => expect(orderMock.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() =>
      expect(screen.getByText(/No passkeys registered yet/i)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /Add New Passkey/i })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Deletion error handling
// ═══════════════════════════════════════════════════════════════════════════
describe("PasskeyManagementDialog — deletion failure (defect #2)", () => {
  const existingPasskey = {
    id: "pk-1",
    device_type: "ios",
    created_at: "2025-01-01T00:00:00Z",
    last_used_at: null,
  };

  const openConfirmAndDelete = async () => {
    render(wrap(<PasskeyManagementDialog open={true} onOpenChange={() => {}} />));
    await waitFor(() => expect(screen.getByText(/iPhone/i)).toBeInTheDocument());
    // The row's trash button is the destructive-styled ghost button in the
    // card. Find it by className since the icon has no accessible name.
    const trashBtn = screen
      .getAllByRole("button")
      .find((b) => b.className.includes("text-destructive"));
    expect(trashBtn).toBeTruthy();
    fireEvent.click(trashBtn!);
    fireEvent.click(await screen.findByRole("button", { name: /^Remove$/i }));
  };

  it("shows the plain-object Supabase message in the destructive toast", async () => {
    selectResult = { data: [existingPasskey], error: null };
    deleteResult = { error: { message: "Delete denied" } };
    await openConfirmAndDelete();
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to remove passkey",
          description: "Delete denied",
          variant: "destructive",
        })
      )
    );
  });

  it("uses the fallback when the error carries no usable message", async () => {
    selectResult = { data: [existingPasskey], error: null };
    deleteResult = { error: { code: "42501" } };
    await openConfirmAndDelete();
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to remove passkey",
          description: "Please try again.",
          variant: "destructive",
        })
      )
    );
  });

  it("does NOT show a success toast, does NOT call removeAccount, and keeps the passkey visible", async () => {
    selectResult = { data: [existingPasskey], error: null };
    deleteResult = { error: { message: "Delete denied" } };
    await openConfirmAndDelete();
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );
    // No success toast
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Passkey removed" })
    );
    // Local metadata untouched
    expect(removeAccountSpy).not.toHaveBeenCalled();
    // Passkey still in the visible list (React Query cache was not invalidated)
    expect(screen.getByText(/iPhone/i)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Signed-out authentication boundary
// ═══════════════════════════════════════════════════════════════════════════
describe("PasskeyManagementDialog — signed-out authentication boundary", () => {
  it("does not query user-scoped passkey data without an authenticated user", async () => {
    authUser = null;

    render(wrap(<PasskeyManagementDialog open={true} onOpenChange={() => {}} />));

    expect(screen.getByRole("heading", { name: /Manage Passkeys/i })).toBeInTheDocument();
    await Promise.resolve();
    expect(selectMock).not.toHaveBeenCalled();
    expect(registerPasskeySpy).not.toHaveBeenCalled();
  });
});
