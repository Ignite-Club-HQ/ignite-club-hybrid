/**
 * Google sign-in must not be offered while the Google provider is switched off
 * on this Supabase instance: tapping it used to land on Supabase's
 * "Unsupported provider" error page. These tests lock in that the button is
 * gone from the email sign-in screen, and that the email screen itself still
 * renders (so the test can't pass on an empty page).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const useAuthMock = vi.fn();

vi.mock("@/live/authBackendMode", () => ({
  isIcpAuthAvailable: () => true,
  isAuthChoiceOverrideOrigin: () => true,
  useIcpAuthScreen: () => false,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/hooks/usePasskey", () => ({
  usePasskey: () => ({
    isAvailable: false,
    isRegistered: false,
    nativeBiometricInfo: null,
    loading: false,
    authenticateWithPasskey: vi.fn(),
    storeCredentialsForNativeBiometric: vi.fn(),
  }),
  isPlatformAuthenticatorAvailable: async () => false,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => ({ isOnline: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor/keyboard", () => ({ Keyboard: { addListener: () => ({ remove: () => {} }) } }));
vi.mock("@/components/ForgotPasswordDialog", () => ({ ForgotPasswordDialog: () => null }));
vi.mock("@/components/InviteFlowProgress", () => ({
  InviteFlowProgress: () => null,
  getInviteFlowContext: () => null,
  clearInviteFlowContext: () => {},
}));

import AuthPage from "./AuthPage";
import { GOOGLE_SIGN_IN_ENABLED } from "@/lib/authProviderFlags";

beforeEach(() => {
  sessionStorage.clear();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({
    user: null,
    profile: null,
    initialized: true,
    profileLoading: false,
    profileResolved: true,
    profileError: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInReady: true,
    resumingSignIn: null,
    loading: false,
  });
});

function renderAuthPage() {
  return render(
    <MemoryRouter initialEntries={["/auth"]}>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/" element={<div>home-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Google sign-in availability", () => {
  it("keeps the provider flag off while Supabase has no Google provider", () => {
    expect(GOOGLE_SIGN_IN_ENABLED).toBe(false);
  });

  it("does not offer Google on the email sign-in screen", () => {
    renderAuthPage();

    // The email screen really did render, so a missing button means the
    // provider is hidden rather than the page being blank.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();

    expect(screen.queryByText("Continue with Google")).toBeNull();
    expect(screen.queryByText("Or")).toBeNull();
  });
});
