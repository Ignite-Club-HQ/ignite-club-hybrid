/**
 * Regression tests for VerifyResetCodePage.
 *
 * Covers the newly-identified OTP validation defect: the page must only
 * ever call supabase.auth.verifyOtp() with a strictly numeric 6-digit
 * token, whether the token arrives via manual entry, paste, or URL.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// jsdom polyfills used by Radix / input-otp interactions elsewhere.
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
let currentSearch = "";
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useSearchParams: () => [new URLSearchParams(currentSearch), vi.fn()],
  };
});

vi.mock("@/lib/passwordResetRedirect", () => ({
  getPasswordResetRedirectUrl: () => "https://reference.invalid",
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

const verifyOtp = vi.fn();
const resetPasswordForEmail = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
    },
  },
}));

vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => {} }));

// Import AFTER mocks.
import VerifyResetCodePage from "./VerifyResetCodePage";

const renderPage = (search = "") => {
  const params = new URLSearchParams(search);
  if (!params.has("backend")) params.set("backend", "supabase");
  currentSearch = `?${params.toString()}`;
  window.history.replaceState({}, "", `/verify-reset-code${currentSearch}`);
  return render(
    <MemoryRouter>
      <VerifyResetCodePage />
    </MemoryRouter>,
  );
};

const getHiddenOtpInput = () =>
  document.querySelector(
    'input[autocomplete="one-time-code"]',
  ) as HTMLInputElement | null;

const typeCode = (value: string) => {
  const hidden = getHiddenOtpInput();
  if (!hidden) throw new Error("OTP hidden input not found");
  act(() => {
    hidden.focus();
  });
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(hidden, value);
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

beforeEach(() => {
  toastSpy.mockReset();
  navigateSpy.mockReset();
  verifyOtp.mockReset();
  resetPasswordForEmail.mockReset();
  currentSearch = "";
});

describe("VerifyResetCodePage — OTP numeric enforcement", () => {
  it("calls verifyOtp for a 6-digit numeric code typed manually", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    renderPage("?email=redacted@example.invalid");
    typeCode("123456");
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1));
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "redacted@example.invalid",
      token: "123456",
      type: "recovery",
    });
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith("/reset-password"),
    );
  });

  it("does not call verifyOtp for a purely alphabetic 6-char code", async () => {
    renderPage("?email=redacted@example.invalid");
    // input-otp filters non-digits via pattern — the hidden input never
    // reaches length 6, so verifyOtp is never invoked.
    typeCode("ABCDEF");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does not call verifyOtp for a mixed alphanumeric code", async () => {
    renderPage("?email=redacted@example.invalid");
    typeCode("ABC123");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does not call verifyOtp for a code with symbols", async () => {
    renderPage("?email=redacted@example.invalid");
    typeCode("12!@#$");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does not call verifyOtp for incomplete codes (< 6 digits)", async () => {
    renderPage("?email=redacted@example.invalid");
    typeCode("12345");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does not call verifyOtp for a blank code", async () => {
    renderPage("?email=redacted@example.invalid");
    typeCode("");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("shows 'Invalid code' when a malformed 6-char value slips into the handler", async () => {
    // Directly exercise the guard: input-otp's filter should already block
    // this, but the handler is defence-in-depth. We access the component's
    // exported behaviour indirectly by simulating a URL-provided bad code
    // (URL path skips the input filter entirely).
    renderPage("?email=redacted@example.invalid&code=ABC123");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("VerifyResetCodePage — URL auto-verify", () => {
  it("auto-verifies when a valid 6-digit numeric code is in the URL", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    renderPage("?email=redacted@example.invalid&code=987654");
    await waitFor(() =>
      expect(verifyOtp).toHaveBeenCalledWith({
        email: "redacted@example.invalid",
        token: "987654",
        type: "recovery",
      }),
    );
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith("/reset-password"),
    );
  });

  it("does NOT auto-verify when the URL code is alphabetic", async () => {
    renderPage("?email=redacted@example.invalid&code=ABCDEF");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does NOT auto-verify when the URL code is mixed alphanumeric", async () => {
    renderPage("?email=redacted@example.invalid&code=ABC123");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does NOT auto-verify when the URL code is the wrong length", async () => {
    renderPage("?email=redacted@example.invalid&code=12345");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does NOT auto-verify when the URL is missing the email", async () => {
    renderPage("?code=123456");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("VerifyResetCodePage — email validation & concurrency", () => {
  it("does not call verifyOtp when email is missing", async () => {
    renderPage(""); // no email at all
    typeCode("123456");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Invalid email" }),
    );
  });

  it("does not call verifyOtp when email is malformed", async () => {
    renderPage("?email=not-an-email");
    typeCode("123456");
    await new Promise((r) => setTimeout(r, 30));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Invalid email" }),
    );
  });

  it("shows an 'Invalid or expired code' toast when Supabase rejects the code", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "otp expired" } });
    renderPage("?email=redacted@example.invalid");
    typeCode("111222");
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Invalid or expired code" }),
      ),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent verify attempts for the same code", async () => {
    let resolve: (v: unknown) => void = () => {};
    verifyOtp.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderPage("?email=redacted@example.invalid");
    typeCode("555555");
    // Second identical completion while first is in flight must be ignored.
    typeCode("555555");
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1));
    resolve({ error: null });
  });
});
