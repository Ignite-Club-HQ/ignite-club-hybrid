import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- mocks ----
const getLiveTeamInviteMock = vi.fn();
const acceptLiveTeamInviteMock = vi.fn();
vi.mock("@/live/features/membership", () => ({
  getLiveTeamInvite: (...args: unknown[]) => getLiveTeamInviteMock(...args),
  acceptLiveTeamInvite: (...args: unknown[]) => acceptLiveTeamInviteMock(...args),
}));

const getLiveJoinLinkByTokenMock = vi.fn();
const getLiveMiniLeagueMock = vi.fn();
const claimLiveAdminJoinLinkMock = vi.fn();
vi.mock("@/live/features/miniLeagues", () => ({
  getLiveJoinLinkByToken: (...args: unknown[]) => getLiveJoinLinkByTokenMock(...args),
  getLiveMiniLeague: (...args: unknown[]) => getLiveMiniLeagueMock(...args),
  claimLiveAdminJoinLink: (...args: unknown[]) => claimLiveAdminJoinLinkMock(...args),
}));

let membershipRoutedToIcp = false;
vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp: (feature: string) => feature === "membership" && membershipRoutedToIcp,
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (_feature: string, providers: any) =>
    membershipRoutedToIcp
      ? providers.icp({ identity: {}, target: {} })
      : providers.supabase(),
}));

vi.mock("@/lab/localRuntimeMode", () => ({
  resolveLocalAuthMode: () => false,
}));

vi.mock("@/live/authBackendMode", () => ({
  resolveAuthBackend: () => (membershipRoutedToIcp ? "icp" : "supabase"),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "principal-abc", email: "parent@example.com" }, loading: false }),
}));

vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ setActiveClubTheme: vi.fn() }),
}));

// Join errors surface via toast (no Toaster is mounted in this test), so
// capture the toast calls to assert on user-facing error messages.
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const rpcMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({ single: () => Promise.resolve({ data: null }), maybeSingle: () => Promise.resolve({ data: null }) }),
  }),
  update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
  insert: () => Promise.resolve({ data: null, error: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => fromMock(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/lib/profileCache", () => ({
  selectCachedProfileById: async () => ({ data: { display_name: "Parent Person" } }),
}));

import JoinTeamPage from "./JoinTeamPage";

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/join/:token" element={<JoinTeamPage />} />
          <Route path="/join/p/:token" element={<JoinTeamPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const regularInviteRow = {
  id: "invite-1",
  team_id: "team-1",
  role: "coach",
  token: "tok-1",
  uses_count: 0,
  max_uses: 5,
  expires_at: null,
  created_at: null,
  created_by: null,
  metadata: null,
  team_name: "Wolves",
  team_logo_url: null,
  club_id: "club-1",
  club_name: "Ignite Club",
};

beforeEach(() => {
  membershipRoutedToIcp = false;
  rpcMock.mockReset();
  getLiveTeamInviteMock.mockReset();
  acceptLiveTeamInviteMock.mockReset();
  getLiveJoinLinkByTokenMock.mockReset();
  getLiveMiniLeagueMock.mockReset();
  claimLiveAdminJoinLinkMock.mockReset();
  rpcMock.mockImplementation((name: string) => {
    if (name === "get_team_invite_by_token") {
      return Promise.resolve({ data: [regularInviteRow], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe("JoinTeamPage team-invite acceptance routing", () => {
  it("Supabase branch: resolves the invite via the RPC (unchanged) when membership is not ICP-routed", async () => {
    membershipRoutedToIcp = false;
    renderAt("/join/tok-1");

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_team_invite_by_token", { _token: "tok-1" }));
    expect(getLiveTeamInviteMock).not.toHaveBeenCalled();
    expect(acceptLiveTeamInviteMock).not.toHaveBeenCalled();
  });

  it("ICP branch: resolves via getLiveTeamInvite and accepts via acceptLiveTeamInvite", async () => {
    membershipRoutedToIcp = true;
    getLiveTeamInviteMock.mockResolvedValue(regularInviteRow);
    acceptLiveTeamInviteMock.mockResolvedValue({});

    renderAt("/join/tok-1");

    await waitFor(() => expect(getLiveTeamInviteMock).toHaveBeenCalledWith(expect.anything(), "tok-1"));
    // get_team_invite_by_token RPC must not be used on the ICP branch.
    expect(rpcMock).not.toHaveBeenCalledWith("get_team_invite_by_token", expect.anything());

    // The button is disabled until the invite role auto-selects into
    // selectedRoles — wait for it to become enabled before clicking.
    const joinButton = await screen.findByRole("button", { name: /join/i });
    await waitFor(() => expect(joinButton).toBeEnabled());
    fireEvent.click(joinButton);

    await waitFor(() => expect(acceptLiveTeamInviteMock).toHaveBeenCalledWith(expect.anything(), "invite-1"));
    expect(getLiveTeamInviteMock).toHaveBeenCalledWith(expect.anything(), "invite-1");
  });

  it("mini-league join under ICP shows an unavailable message instead of joining", async () => {
    membershipRoutedToIcp = true;
    const miniLeagueRow = {
      ...regularInviteRow,
      metadata: { mini_league_id: "league-1" },
    };
    getLiveTeamInviteMock.mockResolvedValue(miniLeagueRow);

    renderAt("/join/tok-1");
    await waitFor(() => expect(getLiveTeamInviteMock).toHaveBeenCalled());

    const joinButton = await screen.findByRole("button", { name: /join/i });
    await waitFor(() => expect(joinButton).toBeEnabled());
    fireEvent.click(joinButton);

    // The join mutation throws and the error surfaces via toast.
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(/mini-league isn't available for internet identity accounts/i),
        }),
      ),
    );
    expect(acceptLiveTeamInviteMock).not.toHaveBeenCalled();
  });

  it("ICP branch: resolves an admin join link via getLiveJoinLinkByToken and claims it via claimLiveAdminJoinLink", async () => {
    membershipRoutedToIcp = true;
    getLiveJoinLinkByTokenMock.mockResolvedValue({
      token: "adm-1",
      mini_league_id: "league-1",
      role: "admin",
      revoked: false,
    });
    getLiveMiniLeagueMock.mockResolvedValue({ id: "league-1", name: "Summer League", club_id: "club-1" });
    claimLiveAdminJoinLinkMock.mockResolvedValue({});

    renderAt("/join/p/adm-1");

    // The pending-invite RPC must not be used on the ICP branch.
    await waitFor(() => expect(getLiveJoinLinkByTokenMock).toHaveBeenCalledWith(expect.anything(), "adm-1"));
    expect(rpcMock).not.toHaveBeenCalledWith("get_pending_invite_by_token", expect.anything());

    const joinButton = await screen.findByRole("button", { name: /join/i });
    await waitFor(() => expect(joinButton).toBeEnabled());
    fireEvent.click(joinButton);

    await waitFor(() => expect(claimLiveAdminJoinLinkMock).toHaveBeenCalledWith(expect.anything(), "adm-1"));
    // Neither the team-invite nor the mini-league block paths may run.
    expect(acceptLiveTeamInviteMock).not.toHaveBeenCalled();
  });
});
