import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "principal:test-member", app_metadata: { provider: "icp" } },
  identity: {},
  grants: vi.fn(), homeCountries: vi.fn(), signOut: vi.fn(),
  emailRead: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useOptionalAuth: () => ({ user: state.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/components/AppSplash", () => ({ AppSplash: () => <div>Loading</div> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.emailRead } }));
vi.mock("@/live/internetIdentityAuth", () => ({
  getCurrentInternetIdentityConfirmed: async () => state.identity,
  signOutInternetIdentity: state.signOut,
}));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({ canisterIds: { club_domain: "test" } }) }));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: state.grants }));
vi.mock("@/live/features/club", () => ({ getLiveClubHomeCountries: state.homeCountries }));

import { ClubBackendEnforcement } from "./ClubBackendEnforcement";
import { applyBackendRoutingConfig, CLUB_HOME_BACKEND_HINT_KEY } from "@/live/backendRouting";
import { getUserClubIds } from "@/live/userClubs";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  window.history.replaceState(null, "", "/auth");
  applyBackendRoutingConfig({ defaultBackend: "supabase", countryRules: { AU: "supabase", DE: "icp" }, targets: [], countryTargets: {}, clubBackendOverrides: {} });
  state.grants.mockResolvedValue([{ club: ["giddy-goat"], role: "parent" }]);
  state.homeCountries.mockResolvedValue({ "giddy-goat": "AU" });
});

describe("confirmed Internet Identity membership", () => {
  it.each(["", "?auth=icp"])("retains the account and canister clubs despite email country defaults (%s)", async (search) => {
    window.history.replaceState(null, "", `/auth${search}`);
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(screen.getByText("Signed-in club")).toBeTruthy());
    expect(getUserClubIds()).toEqual(["giddy-goat"]);
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.emailRead).not.toHaveBeenCalled();
    expect(state.homeCountries).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
    expect(localStorage.getItem(CLUB_HOME_BACKEND_HINT_KEY)).toBe("icp");
    expect(window.location.pathname).toBe("/auth");
  });

  it("preserves the existing hint and session when membership retrieval fails", async () => {
    localStorage.setItem(CLUB_HOME_BACKEND_HINT_KEY, "icp");
    state.grants.mockRejectedValueOnce(new Error("Unavailable"));
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(screen.getByText("Signed-in club")).toBeTruthy());
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.emailRead).not.toHaveBeenCalled();
    expect(localStorage.getItem(CLUB_HOME_BACKEND_HINT_KEY)).toBe("icp");
  });

  it("keeps a new Internet Identity account on-chain before it joins a club", async () => {
    state.grants.mockResolvedValueOnce([]);
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(screen.getByText("Signed-in club")).toBeTruthy());
    expect(getUserClubIds()).toEqual([]);
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.emailRead).not.toHaveBeenCalled();
  });
});