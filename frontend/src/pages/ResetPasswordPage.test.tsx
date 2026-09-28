/**
 * Regression tests for ResetPasswordPage.
 *
 * Covers three newly-identified defects:
 *   1. Password reset form must be locked behind recovery-session validation
 *      (explicit `checking` | `valid` | `invalid` status). Never render an
 *      actionable form or call `updateUser()` until the recovery session is
 *      confirmed.
 *   2. Fallback recovery-code delivery failures must NOT display "Code sent";
 *      they must show a safe non-enumerating error toast, keep the Send code
 *      button ready for retry, and never reveal account existence.
 *   3. OTP verification must validate the email locally before calling
 *      Supabase, must not clear the entered code on validation failure, and
 *      must guard against concurrent verify calls.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// input-otp / Radix helpers need these jsdom polyfills.
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

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => "web",
  },
}));

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: vi.fn(() => Promise.resolve({ remove: () => {} })),
  },
}));

vi.mock("@/components/ui/input-otp", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  const InputOTP = React.forwardRef<HTMLInputElement, {
    value?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    autoFocus?: boolean;
    children?: React.ReactNode;
  }>(({ value = "", onChange, disabled, inputMode, autoFocus, children }, ref) => (
    <div>
      <input
        ref={ref}
        autoComplete="one-time-code"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        inputMode={inputMode}
        autoFocus={autoFocus}
      />
      {children}
    </div>
  ));
  InputOTP.displayName = "InputOTP";

  const InputOTPGroup = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const InputOTPSlot = ({ index }: { index: number }) => <div data-slot-index={index} />;

  return { InputOTP, InputOTPGroup, InputOTPSlot };
});

const exchangeCodeForSession = vi.fn();
const getSession = vi.fn();
const getUser = vi.fn();
const updateUser = vi.fn();
const resetPasswordForEmail = vi.fn();
const verifyOtp = vi.fn();
type AuthCb = (event: string) => void;
let authCallback: AuthCb | null = null;
const onAuthStateChange = vi.fn((cb: AuthCb) => {
  authCallback = cb;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a),
      getSession: (...a: unknown[]) => getSession(...a),
      getUser: (...a: unknown[]) => getUser(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
      onAuthStateChange: (cb: AuthCb) => onAuthStateChange(cb),
    },
  },
}));

// Import AFTER mocks are registered.
import ResetPasswordPage from "./ResetPasswordPage";

const renderPage = () =>
  render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  );

const setHref = (relative: string) => {
  // JSDOM disallows replaceState across origins; use a relative URL.
  // These tests specifically exercise the Supabase recovery-session flow,
  // so explicitly opt out of the lab's default ICP mode (see
  // resolveLocalAuthMode) the same way a real user would via ?backend=supabase.
  const url = new URL(relative, "http://localhost");
  if (!url.searchParams.has("backend")) url.searchParams.set("backend", "supabase");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
};


beforeEach(() => {
  toastSpy.mockReset();
  navigateSpy.mockReset();
  exchangeCodeForSession.mockReset();
  getSession.mockReset();
  getUser.mockReset();
  updateUser.mockReset();
  resetPasswordForEmail.mockReset();
  verifyOtp.mockReset();
  onAuthStateChange.mockClear();
  authCallback = null;
  setHref("/reset-password");
  // Default: no active session (implicit path). Tests override as needed.
  getSession.mockResolvedValue({ data: { session: null } });
  getUser.mockResolvedValue({ data: { user: { email: "redacted@example.invalid" } } });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Recovery-session validation ───────────────────────────────────────

describe("ResetPasswordPage — recovery-session lifecycle", () => {
  it("shows a loading state while checking and hides the password form", async () => {
    // Never resolves during this test — status stays `checking`.
    getSession.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("reset-password-checking")).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset password/i }))
      .not.toBeInTheDocument();
  });

  it("marks the session valid after a successful PKCE code exchange", async () => {
    setHref("/reset-password?code=abc123");
    exchangeCodeForSession.mockResolvedValue({ error: null });
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("reset-password-checking"))
      .not.toBeInTheDocument();
  });

  it("marks the session valid when getSession() confirms an existing recovery session", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "a", refresh_token: "r" } },
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument(),
    );
  });

  it("marks the session valid when a PASSWORD_RECOVERY auth event fires", async () => {
    // No session, but the SDK emits PASSWORD_RECOVERY after our probe.
    renderPage();
    // Wait until the initial establishRecoverySession has resolved to invalid.
    await waitFor(() =>
      expect(screen.getByText(/invalid or expired reset link/i))
        .toBeInTheDocument(),
    );
    act(() => {
      authCallback?.("PASSWORD_RECOVERY");
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument(),
    );
  });

  it("marks the session invalid when the URL carries an error_description", async () => {
    setHref(
      "/reset-password?error_description=" +
        encodeURIComponent("Link expired"),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/link expired/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it("marks the session invalid when exchangeCodeForSession fails", async () => {
    setHref("/reset-password?code=badcode");
    exchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid grant" },
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/invalid or expired reset link/i))
        .toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it("marks the session invalid when no session is found via the implicit flow", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/invalid or expired reset link/i))
        .toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
});

// ── 2. updateUser guard ──────────────────────────────────────────────────

describe("ResetPasswordPage — updateUser guard", () => {
  it("never calls updateUser() while the recovery session is invalid", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/invalid or expired reset link/i))
        .toBeInTheDocument(),
    );
    // The password form is not rendered — updateUser cannot be triggered.
    expect(screen.queryByRole("button", { name: /^reset password$/i }))
      .not.toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

// ── 3. Fallback sendRecoveryCode failure handling ────────────────────────

describe("ResetPasswordPage — sendRecoveryCode fail-closed", () => {
  const openOtpInterface = async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/invalid or expired reset link/i))
        .toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /use a 6-digit code instead/i }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument(),
    );
  };

  it("does NOT show 'Code sent' when Supabase returns an error", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "smtp failure" },
    });
    await openOtpInterface();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "redacted@example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to send code" }),
      ),
    );
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Code sent" }),
    );
    // Send code button restored for retry.
    expect(screen.getByRole("button", { name: /send code/i })).not.toBeDisabled();
  });

  it("does NOT show 'Code sent' when resetPasswordForEmail throws", async () => {
    resetPasswordForEmail.mockRejectedValue(new Error("network down"));
    await openOtpInterface();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "redacted@example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to send code" }),
      ),
    );
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Code sent" }),
    );
    expect(screen.getByRole("button", { name: /send code/i })).not.toBeDisabled();
  });

  it("shows 'Code sent' only on a successful send", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await openOtpInterface();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "redacted@example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Code sent" }),
      ),
    );
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Unable to send code" }),
    );
  });

  it("allows an immediate retry after a failed send", async () => {
    resetPasswordForEmail
      .mockResolvedValueOnce({ data: {}, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: {}, error: null });
    await openOtpInterface();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "redacted@example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Code sent" }),
      ),
    );
  });

  it("deduplicates concurrent send-code clicks", async () => {
    let resolveSend: (v: unknown) => void = () => {};
    resetPasswordForEmail.mockReturnValue(
      new Promise((r) => {
        resolveSend = r;
      }),
    );
    await openOtpInterface();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "redacted@example.invalid" },
    });
    const btn = screen.getByRole("button", { name: /send code/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledTimes(1));
    resolveSend({ data: {}, error: null });
  });
});

// ── 4. OTP verification hardening ────────────────────────────────────────

describe("ResetPasswordPage — OTP verification", () => {
  const openOtpInterface = async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/invalid or expired reset link/i))
        .toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /use a 6-digit code instead/i }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument(),
    );
  };

  it("does not call verifyOtp when the email is empty", async () => {
    await openOtpInterface();
    // Directly simulate a completed 6-digit code without setting an email.
    // The InputOTP hidden input carries the value.
    const hidden = document.querySelector(
      'input[autocomplete="one-time-code"]',
    ) as HTMLInputElement | null;
    expect(hidden).not.toBeNull();
    fireEvent.change(hidden!, { target: { value: "123456" } });

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Enter your email" }),
      ),
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does not clear the entered code when the email is invalid", async () => {
    await openOtpInterface();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "not-an-email" },
    });
    const hidden = document.querySelector(
      'input[autocomplete="one-time-code"]',
    ) as HTMLInputElement | null;
    fireEvent.change(hidden!, { target: { value: "654321" } });

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Enter your email" }),
      ),
    );
    expect(verifyOtp).not.toHaveBeenCalled();
    // Code preserved.
    expect(
      (document.querySelector(
        'input[autocomplete="one-time-code"]',
      ) as HTMLInputElement).value,
    ).toBe("654321");
  });

  it("flips status to valid and shows the password form after successful verification", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    await openOtpInterface();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "redacted@example.invalid" },
    });
    const hidden = document.querySelector(
      'input[autocomplete="one-time-code"]',
    ) as HTMLInputElement | null;
    fireEvent.change(hidden!, { target: { value: "111222" } });

    await waitFor(() =>
      expect(verifyOtp).toHaveBeenCalledWith({
        email: "redacted@example.invalid",
        token: "111222",
        type: "recovery",
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument(),
    );
  });

  it("deduplicates concurrent verifyOtp calls", async () => {
    let resolveVerify: (v: unknown) => void = () => {};
    verifyOtp.mockReturnValue(
      new Promise((r) => {
        resolveVerify = r;
      }),
    );
    await openOtpInterface();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "redacted@example.invalid" },
    });
    const hidden = document.querySelector(
      'input[autocomplete="one-time-code"]',
    ) as HTMLInputElement | null;
    // Fire the same 6-digit change twice — the second must be ignored while
    // the first is still in flight.
    fireEvent.change(hidden!, { target: { value: "999888" } });
    fireEvent.change(hidden!, { target: { value: "999888" } });
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1));
    resolveVerify({ data: {}, error: null });
  });
});
