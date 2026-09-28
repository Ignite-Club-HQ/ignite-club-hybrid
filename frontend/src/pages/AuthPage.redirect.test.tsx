/**
 * Regression tests for post-authentication redirect handling on AuthPage.
 *
 * These lock in three properties of the fix:
 *   1. A pending `redirectAfterAuth` (including query + hash) survives auth
 *      resolution and is used as the <Navigate> destination.
 *   2. The stored destination is consumed exactly once.
 *   3. Hostile / off-origin destinations are rejected in favour of `/`.
 *
 * We stub `useAuth` and `usePasskey` so the test drives AuthPage purely on
 * the auth-state props that matter for the redirect decision, and we render
 * a sibling route so a resulting <Navigate> flips the visible content.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const useAuthMock = vi.fn();
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

const authedUser = {
  id: "user-1",
  created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
} as any;

function renderAuthPage() {
  return render(
    <MemoryRouter initialEntries={["/auth"]}>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/events" element={<div>events-page</div>} />
        <Route path="/" element={<div>home-page</div>} />
        <Route path="/complete-profile" element={<div>complete-profile-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({
    user: authedUser,
    profile: { id: "user-1", display_name: "Alex", avatar_url: "x" },
    initialized: true,
    profileLoading: false,
    profileResolved: true,
    profileError: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: vi.fn(),
    loading: false,
  });
});

describe("AuthPage post-auth redirect", () => {
  it("routes an authenticated visitor to the stored destination with query + hash preserved", async () => {
    sessionStorage.setItem("redirectAfterAuth", "/events?view=calendar#upcoming");

    renderAuthPage();

    await waitFor(() => expect(screen.getByText("events-page")).toBeInTheDocument());
    // Stored destination must be consumed exactly once.
    expect(sessionStorage.getItem("redirectAfterAuth")).toBeNull();
  });

  it("falls back to home when no destination is stored", async () => {
    renderAuthPage();
    await waitFor(() => expect(screen.getByText("home-page")).toBeInTheDocument());
  });

  it("rejects hostile off-origin destinations and routes to home", async () => {
    sessionStorage.setItem("redirectAfterAuth", "//evil.example/steal");
    renderAuthPage();
    await waitFor(() => expect(screen.getByText("home-page")).toBeInTheDocument());
    // Hostile value is wiped so it can't be inherited by a later sign-in.
    expect(sessionStorage.getItem("redirectAfterAuth")).toBeNull();
  });

  it("rejects absolute URLs", async () => {
    sessionStorage.setItem("redirectAfterAuth", "https://reference.invalid");
    renderAuthPage();
    await waitFor(() => expect(screen.getByText("home-page")).toBeInTheDocument());
    expect(sessionStorage.getItem("redirectAfterAuth")).toBeNull();
  });

  it("does not treat /auth as a valid destination (no loop)", async () => {
    sessionStorage.setItem("redirectAfterAuth", "/auth?mode=signup");
    renderAuthPage();
    await waitFor(() => expect(screen.getByText("home-page")).toBeInTheDocument());
  });

  it("routes to /complete-profile when display_name is missing, ignoring stored destination is NOT required", async () => {
    // When a stored destination exists, it wins even if profile isn't complete —
    // this matches the invite flow behaviour where users are sent to the
    // invite target and complete profile there.
    sessionStorage.setItem("redirectAfterAuth", "/events");
    useAuthMock.mockReturnValue({
      user: authedUser,
      profile: { id: "user-1", display_name: null, avatar_url: null },
      initialized: true,
      profileLoading: false,
      profileResolved: true,
      profileError: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signInWithGoogle: vi.fn(),
      loading: false,
    });
    renderAuthPage();
    await waitFor(() => expect(screen.getByText("events-page")).toBeInTheDocument());
  });

  it("routes to /complete-profile when there is no stored destination and display_name is missing", async () => {
    useAuthMock.mockReturnValue({
      user: authedUser,
      profile: { id: "user-1", display_name: null, avatar_url: null },
      initialized: true,
      profileLoading: false,
      profileResolved: true,
      profileError: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signInWithGoogle: vi.fn(),
      loading: false,
    });
    renderAuthPage();
    await waitFor(() => expect(screen.getByText("complete-profile-page")).toBeInTheDocument());
  });
});
