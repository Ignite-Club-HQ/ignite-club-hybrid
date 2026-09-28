import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const signInWithGoogleMock = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    initialized: true,
    profileLoading: false,
    profileResolved: true,
    profileError: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: signInWithGoogleMock,
    loading: false,
  }),
}));
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

beforeEach(() => {
  signInWithGoogleMock.mockReset();
  signInWithGoogleMock.mockResolvedValue({ error: null });
  window.history.pushState({}, "", "/auth?backend=icp");
});

describe("AuthPage ICP mode", () => {
  it("offers Internet Identity sign-in instead of Supabase identity flows", async () => {
    render(<MemoryRouter initialEntries={["/auth?backend=icp"]}><AuthPage /></MemoryRouter>);

    expect(screen.getByText(/Sign in with your Internet Identity passkey/i)).toBeInTheDocument();
    expect(screen.queryByText(/Continue with Google/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Continue with Internet Identity/i }));
    await waitFor(() => expect(signInWithGoogleMock).toHaveBeenCalledTimes(1));
  });

  it("surfaces Internet Identity sign-in failures inline", async () => {
    signInWithGoogleMock.mockResolvedValue({ error: new Error("Local Internet Identity is not configured") });

    render(<MemoryRouter initialEntries={["/auth?backend=icp"]}><AuthPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Continue with Internet Identity/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Local Internet Identity is not configured/i));
  });
});
