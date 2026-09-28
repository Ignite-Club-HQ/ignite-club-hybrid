/**
 * Regression tests for ForgotPasswordDialog.
 *
 * Covers the newly-identified delivery bug: failed
 * `supabase.auth.resetPasswordForEmail` responses (both returned errors and
 * thrown exceptions) must not advance to the code-entry step, must not start
 * the resend cooldown, must surface a safe non-enumerating error toast, and
 * must leave the Send/Resend button ready for retry. Successful requests keep
 * the existing privacy-preserving UX (always advance, always start cooldown,
 * regardless of whether the account exists).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ForgotPasswordDialog } from "./ForgotPasswordDialog";

// input-otp calls ResizeObserver + document.elementFromPoint on mount — jsdom lacks both.
if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
}


// ── mocks ────────────────────────────────────────────────────────────────
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock("@/lib/passwordResetRedirect", () => ({
  getPasswordResetRedirectUrl: () => "https://reference.invalid",
}));

const resetPasswordForEmail = vi.fn();
const verifyOtp = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args: unknown[]) =>
        resetPasswordForEmail(...args),
      verifyOtp: (...args: unknown[]) => verifyOtp(...args),
    },
  },
}));

// ── helpers ──────────────────────────────────────────────────────────────
const renderDialog = (defaultEmail = "redacted@example.invalid") => {
  return render(
    <MemoryRouter>
      <ForgotPasswordDialog
        open
        onOpenChange={() => {}}
        defaultEmail={defaultEmail}
      />
    </MemoryRouter>,
  );
};

const clickSendCode = () => {
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
};

beforeEach(() => {
  toastSpy.mockReset();
  navigateSpy.mockReset();
  resetPasswordForEmail.mockReset();
  verifyOtp.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── tests ────────────────────────────────────────────────────────────────
describe("ForgotPasswordDialog — initial Send Code", () => {
  it("advances to the code step and starts the cooldown on success", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    renderDialog();
    clickSendCode();
    await waitFor(() =>
      expect(screen.getByText(/6-digit code/i)).toBeInTheDocument(),
    );
    // Cooldown started (button shows the seconds countdown).
    expect(
      screen.getByRole("button", { name: /resend code in \d+s/i }),
    ).toBeInTheDocument();
    // No "Code resent" toast on the initial send.
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Code resent" }),
    );
  });

  it("does NOT advance to the code step when Supabase returns an error", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: "Service unavailable" },
    });
    renderDialog();
    clickSendCode();
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    // Still on the email step.
    expect(screen.queryByText(/6-digit code/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send code/i }),
    ).toBeEnabled();
  });

  it("shows a safe non-enumerating toast on send failure", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: "User with email not found" },
    });
    renderDialog();
    clickSendCode();
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Unable to send code",
          description:
            "We couldn't send the verification code. Check your connection and try again.",
        }),
      ),
    );
    // Raw backend message must not leak into the UI.
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/not found/i),
      }),
    );
  });

  it("does NOT advance or start the cooldown when Supabase throws", async () => {
    resetPasswordForEmail.mockRejectedValue(new Error("network down"));
    renderDialog();
    clickSendCode();
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to send code" }),
      ),
    );
    expect(screen.queryByText(/6-digit code/i)).not.toBeInTheDocument();
    // No cooldown countdown rendered.
    expect(
      screen.queryByRole("button", { name: /resend code in \d+s/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the Send Code button enabled after a failed request (retry allowed)", async () => {
    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    renderDialog();
    clickSendCode();
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to send code" }),
      ),
    );
    const btn = screen.getByRole("button", { name: /send code/i });
    expect(btn).toBeEnabled();

    // Retry succeeds and now advances.
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText(/6-digit code/i)).toBeInTheDocument(),
    );
  });

  it("prevents concurrent initial-send requests", async () => {
    let resolve!: (v: { data: unknown; error: null }) => void;
    resetPasswordForEmail.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderDialog();
    const btn = screen.getByRole("button", { name: /send code/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ data: {}, error: null });
    });
  });

  it("rejects an invalid email locally without hitting Supabase", () => {
    renderDialog("not-an-email");
    clickSendCode();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Invalid email" }),
    );
  });
});

describe("ForgotPasswordDialog — Resend from code step", () => {
  const advanceToCodeStep = async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    renderDialog();
    const sendBtn = screen.getByRole("button", { name: /send code/i });
    fireEvent.click(sendBtn);
    await waitFor(() =>
      expect(screen.getByText(/6-digit code/i)).toBeInTheDocument(),
    );
    // Drain the 45s cooldown. Advance one second at a time so React can
    // flush its re-render + re-arm the next setTimeout between ticks.
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    vi.useRealTimers();
  };



  it("does NOT show 'Code resent' when the resend fails", async () => {
    await advanceToCodeStep();
    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^resend code$/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to send code" }),
      ),
    );
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Code resent" }),
    );
  });

  it("does NOT restart the cooldown when the resend fails", async () => {
    await advanceToCodeStep();
    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^resend code$/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to send code" }),
      ),
    );
    // Resend button is enabled again (no cooldown countdown).
    expect(
      screen.queryByRole("button", { name: /resend code in \d+s/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^resend code$/i }),
    ).toBeEnabled();
  });

  it("does NOT clear an in-progress code when the resend fails", async () => {
    await advanceToCodeStep();
    // Simulate the user having typed a code (state lives inside the dialog).
    // We type into the OTP by dispatching input events on the hidden input.
    const otpInputs = document.querySelectorAll("input");
    // The OTP renders a single underlying <input>. Find it (last input, after email).
    const otpInput = Array.from(otpInputs).find(
      (i) => i.getAttribute("inputmode") === "numeric",
    ) as HTMLInputElement | undefined;
    if (otpInput) {
      fireEvent.change(otpInput, { target: { value: "123" } });
    }
    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^resend code$/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to send code" }),
      ),
    );
    if (otpInput) {
      expect(otpInput.value).toBe("123");
    }
  });

  it("shows 'Code resent' and restarts the cooldown only on success", async () => {
    await advanceToCodeStep();
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    fireEvent.click(screen.getByRole("button", { name: /^resend code$/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Code resent" }),
      ),
    );
    expect(
      screen.getByRole("button", { name: /resend code in \d+s/i }),
    ).toBeInTheDocument();
  });

  it("prevents concurrent resend requests", async () => {
    await advanceToCodeStep();
    resetPasswordForEmail.mockClear();
    let resolve!: (v: { data: unknown; error: null }) => void;
    resetPasswordForEmail.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const btn = screen.getByRole("button", { name: /^resend code$/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ data: {}, error: null });
    });
  });
});
