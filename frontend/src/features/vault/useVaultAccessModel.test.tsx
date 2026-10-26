/**
 * Contract tests for `useVaultAccessModel` — the access/entitlement/root-
 * navigation data model extracted from `VaultPage`. Exercises the actual
 * composed React Query + effect behaviour (not just source-string matches),
 * since this is a higher-risk data-model extraction than the prior
 * workflow/presentation splits.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useVaultAccessModel } from "./useVaultAccessModel";
import type { FolderView } from "./useVaultExport";
import type { VaultClubSummary } from "./vaultAccessRepository";

const fetchVaultAppAdmin = vi.fn<(userId: string) => Promise<boolean>>();
const fetchVaultUserRoles = vi.fn<(userId: string, client?: unknown, selectedClubId?: string | null) => Promise<any[]>>();
const featureRouting = vi.hoisted(() => ({ icp: false }));
const warmFolders = vi.hoisted(() => vi.fn(async () => []));
const warmItems = vi.hoisted(() => vi.fn(async () => []));
vi.mock("./vaultReadRepository", () => ({ fetchVaultSubfolders: warmFolders, fetchVaultItems: warmItems }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => featureRouting.icp }));
const fetchVaultAccessibleClubs = vi.fn<(userId: string, isAppAdmin: boolean, client?: unknown, selectedClubId?: string | null) => Promise<VaultClubSummary[]>>();
const fetchVaultClubHasPro = vi.fn<(clubId: string) => Promise<boolean>>();
const fetchVaultTeamHasPro = vi.fn<(teamId: string) => Promise<boolean>>();
const fetchVaultAnyProAccess = vi.fn<(userId: string) => Promise<boolean>>();

// useVaultAccessModel now sources the app-admin flag from the shared
// useIsAppAdmin hook; mock the hook with an equivalent useQuery so the
// existing fetchVaultAppAdmin expectations (including pending-promise
// loading gates) keep driving the same cache-key semantics.
vi.mock("@/hooks/useIsAppAdmin", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useIsAppAdmin: () => {
      const query = useQuery({
        queryKey: ["is-app-admin", "user-1"],
        queryFn: () => fetchVaultAppAdmin("user-1"),
      });
      return { isAppAdmin: query.data === true, isLoading: query.isPending, error: query.error };
    },
  };
});

vi.mock("./vaultAccessRepository", () => ({
  fetchVaultAppAdmin: (...args: [string]) => fetchVaultAppAdmin(...args),
  fetchVaultUserRoles: (...args: [string, unknown?, (string | null)?]) => fetchVaultUserRoles(...args),
  fetchVaultAccessibleClubs: (...args: [string, boolean, unknown?, (string | null)?]) => fetchVaultAccessibleClubs(...args),
  fetchVaultClubHasPro: (...args: [string]) => fetchVaultClubHasPro(...args),
  fetchVaultTeamHasPro: (...args: [string]) => fetchVaultTeamHasPro(...args),
  fetchVaultAnyProAccess: (...args: [string]) => fetchVaultAnyProAccess(...args),
}));

const rootView: FolderView = { type: "root" };
const clubView: FolderView = { type: "club", clubId: "club-a", clubName: "Club A" };
const teamView: FolderView = {
  type: "team",
  clubId: "club-a",
  clubName: "Club A",
  teamId: "team-a",
  teamName: "Team A",
};

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function renderAccessModel(overrides: {
  currentView?: FolderView;
  activeClubFilter?: string | null;
  onAutoNavigateToClub?: (clubId: string, clubName: string) => void;
} = {}) {
  const onAutoNavigateToClub = overrides.onAutoNavigateToClub ?? vi.fn();
  const wrapper = makeWrapper();
  const view = overrides.currentView ?? rootView;
  const activeClubFilter = overrides.activeClubFilter ?? null;
  const { result, rerender } = renderHook(
    (props: { currentView: FolderView; activeClubFilter: string | null }) =>
      useVaultAccessModel({
        userId: "user-1",
        currentView: props.currentView,
        activeClubFilter: props.activeClubFilter,
        onAutoNavigateToClub,
      }),
    { wrapper, initialProps: { currentView: view, activeClubFilter } },
  );
  return { result, rerender, onAutoNavigateToClub };
}

beforeEach(() => {
  warmFolders.mockClear();
  warmItems.mockClear();
  featureRouting.icp = false;
  fetchVaultAppAdmin.mockReset().mockResolvedValue(false);
  fetchVaultUserRoles.mockReset().mockResolvedValue([]);
  fetchVaultAccessibleClubs.mockReset().mockResolvedValue([]);
  fetchVaultClubHasPro.mockReset().mockResolvedValue(false);
  fetchVaultTeamHasPro.mockReset().mockResolvedValue(false);
  fetchVaultAnyProAccess.mockReset().mockResolvedValue(false);
});

afterEach(() => vi.useRealTimers());

describe("useVaultAccessModel — access decision", () => {
  it("reports failed subscription checks as retryable errors, not established Free access", async () => {
    fetchVaultUserRoles.mockResolvedValue([{ role: "coach", club_id: "club-a", team_id: null }]);
    fetchVaultClubHasPro.mockRejectedValueOnce(new Error("Subscription temporarily unavailable")).mockResolvedValue(true);
    const { result } = renderAccessModel({ currentView: clubView });
    await waitFor(() => expect(result.current.accessError).toBeInstanceOf(Error));
    expect(result.current.canAccessVault).toBe(false);
    result.current.retryAccess();
    await waitFor(() => expect(result.current.canAccessVault).toBe(true));
    expect(result.current.accessError).toBeNull();
  });
  it("opens for an app admin without waiting for unrelated Pro scans", async () => {
    fetchVaultAppAdmin.mockResolvedValue(true);
    fetchVaultAnyProAccess.mockReturnValue(new Promise(() => {}));
    const { result } = renderAccessModel();
    await waitFor(() => expect(result.current.isAppAdmin).toBe(true));
    await waitFor(() => expect(result.current.isLoadingAccess).toBe(false));
    expect(result.current.canAccessVault).toBe(true);
  });
  it("grants an app admin access regardless of role or Pro entitlement", async () => {
    fetchVaultAppAdmin.mockResolvedValue(true);
    const { result } = renderAccessModel();
    await waitFor(() => expect(result.current.isLoadingAccess).toBe(false));
    expect(result.current.isAppAdmin).toBe(true);
    expect(result.current.canAccessVault).toBe(true);
    expect(result.current.hasProButNoRole).toBe(false);
  });

  it("denies a non-admin with a qualifying role but no Pro entitlement anywhere", async () => {
    fetchVaultUserRoles.mockResolvedValue([{ role: "coach", club_id: "club-a", team_id: null }]);
    const { result } = renderAccessModel();
    await waitFor(() => expect(result.current.isLoadingAccess).toBe(false));
    expect(result.current.hasVaultRoleAccess).toBe(true);
    expect(result.current.canAccessVault).toBe(false);
    expect(result.current.hasProButNoRole).toBe(false);
  });

  it("reports a Pro-but-no-role denial distinctly at root", async () => {
    fetchVaultUserRoles.mockResolvedValue([]);
    fetchVaultAnyProAccess.mockResolvedValue(true);
    const { result } = renderAccessModel();
    await waitFor(() => expect(result.current.isLoadingAccess).toBe(false));
    expect(result.current.hasVaultRoleAccess).toBe(false);
    expect(result.current.canAccessVault).toBe(false);
    expect(result.current.hasProButNoRole).toBe(true);
  });

  it("grants root access when both a qualifying role and any-Pro entitlement resolve", async () => {
    fetchVaultUserRoles.mockResolvedValue([{ role: "coach", club_id: "club-a", team_id: null }]);
    fetchVaultAnyProAccess.mockResolvedValue(true);
    const { result } = renderAccessModel();
    await waitFor(() => expect(result.current.isLoadingAccess).toBe(false));
    expect(result.current.canAccessVault).toBe(true);
    expect(result.current.hasProButNoRole).toBe(false);
  });

  it("aggregates the loading gate across every constituent access query", async () => {
    let resolveAppAdmin!: (v: boolean) => void;
    fetchVaultAppAdmin.mockReturnValue(new Promise((resolve) => { resolveAppAdmin = resolve; }));
    const { result } = renderAccessModel();
    expect(result.current.isLoadingAccess).toBe(true);
    resolveAppAdmin(false);
    await waitFor(() => expect(result.current.isLoadingAccess).toBe(false));
  });
});

describe("useVaultAccessModel — scoped Pro entitlement", () => {
  it("opens a selected ICP club using its exact allowance without waiting for unrelated subscriptions or repeating the allowance", async () => {
    featureRouting.icp = true;
    fetchVaultAppAdmin.mockReturnValue(new Promise(() => {}));
    fetchVaultUserRoles.mockResolvedValue([{ role: "club_admin", club_id: "club-a", team_id: null }]);
    fetchVaultAccessibleClubs.mockResolvedValue([{ id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 }]);
    fetchVaultAnyProAccess.mockReturnValue(new Promise(() => {}));
    fetchVaultClubHasPro.mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderAccessModel({ activeClubFilter: "club-a" });
    await waitFor(() => expect(result.current.canAccessVault).toBe(true));
    expect(fetchVaultUserRoles).toHaveBeenCalledWith("user-1", undefined, "club-a");
    rerender({ currentView: clubView, activeClubFilter: "club-a" });
    await waitFor(() => expect(result.current.currentClubHasPro).toBe(true));
    expect(result.current.isLoadingAccess).toBe(false);
    expect(fetchVaultClubHasPro).not.toHaveBeenCalled();
  });
  it("does not replace an unrelated club's scoped allowance with the selected club's premium", async () => {
    featureRouting.icp = true;
    fetchVaultUserRoles.mockResolvedValue([{ role: "club_admin", club_id: "club-a", team_id: null }]);
    fetchVaultAccessibleClubs.mockResolvedValue([{ id: "club-b", name: "Club B", is_pro: true, storage_used_bytes: 0 }]);
    fetchVaultClubHasPro.mockResolvedValue(false);
    const { result } = renderAccessModel({ currentView: clubView, activeClubFilter: "club-b" });
    await waitFor(() => expect(result.current.currentClubHasPro).toBe(false));
    expect(result.current.canAccessVault).toBe(false);
  });
  it("does not grant a selected premium Vault before a qualifying role resolves", async () => {
    featureRouting.icp = true;
    fetchVaultAppAdmin.mockResolvedValue(false);
    fetchVaultUserRoles.mockReturnValue(new Promise(() => {}));
    fetchVaultAccessibleClubs.mockResolvedValue([{ id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 }]);
    const { result } = renderAccessModel({ activeClubFilter: "club-a" });
    await waitFor(() => expect(result.current.hasProClub).toBe(true));
    expect(result.current.canAccessVault).toBe(false);
    expect(result.current.isLoadingAccess).toBe(true);
  });
  it("does not reread a selected ICP club when app-admin status resolves", async () => {
    featureRouting.icp = true;
    fetchVaultAppAdmin.mockResolvedValue(true);
    fetchVaultAccessibleClubs.mockResolvedValue([{ id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 }]);
    const { result } = renderAccessModel({ activeClubFilter: "club-a" });
    await waitFor(() => expect(result.current.isAppAdmin).toBe(true));
    await waitFor(() => expect(result.current.userClubs?.length).toBe(1));
    expect(fetchVaultAccessibleClubs).toHaveBeenCalledTimes(1);
  });
  it("opens an authorized club while unrelated any-Pro discovery remains pending", async () => {
    fetchVaultUserRoles.mockResolvedValue([{ role: "coach", club_id: "club-a", team_id: null }]);
    fetchVaultClubHasPro.mockResolvedValue(true);
    fetchVaultAnyProAccess.mockReturnValue(new Promise(() => {}));
    const { result } = renderAccessModel({ currentView: clubView });
    await waitFor(() => expect(result.current.isLoadingAccess).toBe(false));
    expect(result.current.canAccessVault).toBe(true);
  });
  it("opens a Pro club team without waiting for its redundant team subscription", async () => {
    fetchVaultUserRoles.mockResolvedValue([{ role: "coach", club_id: "club-a", team_id: "team-a" }]);
    fetchVaultClubHasPro.mockResolvedValue(true);
    fetchVaultTeamHasPro.mockReturnValue(new Promise(() => {}));
    const { result } = renderAccessModel({ currentView: teamView });
    await waitFor(() => expect(result.current.isLoadingAccess).toBe(false));
    expect(result.current.canAccessVault).toBe(true);
  });
  it("scopes club-view Pro entitlement to the club subscription only", async () => {
    fetchVaultClubHasPro.mockResolvedValue(true);
    const { result } = renderAccessModel({ currentView: clubView });
    await waitFor(() => expect(result.current.currentClubHasPro).toBe(true));
    expect(result.current.currentContextHasPro).toBe(true);
    expect(fetchVaultTeamHasPro).not.toHaveBeenCalled();
  });

  it("lets a team inherit club Pro even when the team itself has no subscription", async () => {
    fetchVaultClubHasPro.mockResolvedValue(true);
    fetchVaultTeamHasPro.mockResolvedValue(false);
    const { result } = renderAccessModel({ currentView: teamView });
    await waitFor(() => expect(result.current.currentClubHasPro).toBe(true));
    await waitFor(() => expect(result.current.currentContextHasPro).toBe(true));
  });

  it("lets a team use its own Pro subscription when the club is free", async () => {
    fetchVaultClubHasPro.mockResolvedValue(false);
    fetchVaultTeamHasPro.mockResolvedValue(true);
    const { result } = renderAccessModel({ currentView: teamView });
    await waitFor(() => expect(result.current.currentTeamHasPro).toBe(true));
    expect(result.current.currentContextHasPro).toBe(true);
  });

  it("does not query club/team Pro entitlement at the root view", async () => {
    renderAccessModel({ currentView: rootView });
    await waitFor(() => expect(fetchVaultAnyProAccess).toHaveBeenCalled());
    expect(fetchVaultClubHasPro).not.toHaveBeenCalled();
    expect(fetchVaultTeamHasPro).not.toHaveBeenCalled();
  });
});

describe("useVaultAccessModel — role-derived permissions", () => {
  it("isolates club-admin/committee visibility to the active club", async () => {
    fetchVaultUserRoles.mockResolvedValue([
      { role: "club_admin", club_id: "club-b", team_id: null },
      { role: "committee_member", club_id: "club-a", team_id: null },
    ]);
    const { result } = renderAccessModel({ currentView: clubView });
    await waitFor(() => expect(result.current.userRoles?.length).toBe(2));
    expect(result.current.isClubAdmin).toBe(true);

    const other = renderAccessModel({
      currentView: { type: "club", clubId: "club-c", clubName: "Club C" },
    });
    await waitFor(() => expect(other.result.current.userRoles?.length).toBe(2));
    expect(other.result.current.isClubAdmin).toBe(false);
  });

  it("prefers a club-admin upgrade route over a team-admin route", async () => {
    fetchVaultUserRoles.mockResolvedValue([
      { role: "team_admin", club_id: null, team_id: "team-a" },
      { role: "club_admin", club_id: "club-a", team_id: null },
    ]);
    const { result } = renderAccessModel();
    await waitFor(() => expect(result.current.adminUpgradeInfo.clubId).toBe("club-a"));
    expect(result.current.adminUpgradeInfo.teamId).toBeUndefined();
  });

  it("preserves team ids in role order without deduplicating", async () => {
    fetchVaultUserRoles.mockResolvedValue([
      { role: "coach", club_id: null, team_id: "team-a" },
      { role: "coach", club_id: null, team_id: "team-a" },
      { role: "coach", club_id: null, team_id: "team-b" },
    ]);
    const { result } = renderAccessModel();
    await waitFor(() => expect(result.current.userTeamIds).toEqual(["team-a", "team-a", "team-b"]));
  });
});

describe("useVaultAccessModel — root auto-navigation", () => {
  const proClub: VaultClubSummary = { id: "club-x", name: "Club X", is_pro: true, storage_used_bytes: 0 };
  const freeClub: VaultClubSummary = { id: "club-y", name: "Club Y", is_pro: false, storage_used_bytes: 0 };

  it("navigates once into a Pro club matching the active theme filter", async () => {
    fetchVaultAccessibleClubs.mockResolvedValue([proClub, freeClub]);
    const { result, onAutoNavigateToClub } = renderAccessModel({
      currentView: rootView,
      activeClubFilter: "club-x",
    });
    await waitFor(() => expect(onAutoNavigateToClub).toHaveBeenCalledTimes(1));
    expect(onAutoNavigateToClub).toHaveBeenCalledWith("club-x", "Club X");
    expect(fetchVaultAccessibleClubs).toHaveBeenCalledWith("user-1", false, undefined, "club-x");
    await waitFor(() => expect(result.current.userClubs?.length).toBe(2));
    // A subsequent render (e.g. club list refetch) must not re-fire.
    expect(onAutoNavigateToClub).toHaveBeenCalledTimes(1);
  });

  it("does not navigate into a non-Pro club matching the active theme filter", async () => {
    fetchVaultAccessibleClubs.mockResolvedValue([proClub, freeClub]);
    const { result, onAutoNavigateToClub } = renderAccessModel({
      currentView: rootView,
      activeClubFilter: "club-y",
    });
    await waitFor(() => expect(result.current.userClubs?.length).toBe(2));
    expect(onAutoNavigateToClub).not.toHaveBeenCalled();
  });

  it("does not navigate when the current view is not root", async () => {
    fetchVaultAccessibleClubs.mockResolvedValue([proClub]);
    const { result, onAutoNavigateToClub } = renderAccessModel({
      currentView: clubView,
      activeClubFilter: "club-x",
    });
    await waitFor(() => expect(result.current.userClubs?.length).toBe(1));
    expect(onAutoNavigateToClub).not.toHaveBeenCalled();
  });

  it("does not navigate without an active theme filter", async () => {
    fetchVaultAccessibleClubs.mockResolvedValue([proClub]);
    const { result, onAutoNavigateToClub } = renderAccessModel({
      currentView: rootView,
      activeClubFilter: null,
    });
    await waitFor(() => expect(result.current.userClubs?.length).toBe(1));
    expect(onAutoNavigateToClub).not.toHaveBeenCalled();
  });
});

describe("useVaultAccessModel — eligible clubs query", () => {
  it("warms root club folders only for the caller's qualifying club roles", async () => {
    featureRouting.icp = true;
    fetchVaultUserRoles.mockResolvedValue([{ role: "coach", club_id: "club-a", team_id: null }]);
    fetchVaultAnyProAccess.mockResolvedValue(true);
    fetchVaultAccessibleClubs.mockResolvedValue([
      { id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 },
      { id: "club-b", name: "Club B", is_pro: true, storage_used_bytes: 0 },
    ]);
    renderAccessModel();
    await waitFor(() => expect(warmFolders).toHaveBeenCalledTimes(1));
    expect(warmFolders).toHaveBeenCalledWith(expect.objectContaining({ view: clubView, clubRoles: new Set(["coach"]) }));
    await waitFor(() => expect(warmItems).toHaveBeenCalledTimes(1));
    expect(fetchVaultClubHasPro).toHaveBeenCalledWith("club-a");
    expect(fetchVaultClubHasPro).not.toHaveBeenCalledWith("club-b");
  });
  it("reveals the loaded selected club immediately while its exact allowance is pending, without granting access from labels", async () => {
    featureRouting.icp = true;
    fetchVaultUserRoles.mockResolvedValue([{ role: "club_admin", club_id: "club-a", team_id: null }]);
    fetchVaultAnyProAccess.mockResolvedValue(true);
    fetchVaultAccessibleClubs.mockImplementation(async (_user, _admin, _client, club) => club
      ? new Promise(() => {})
      : [{ id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 }]);
    const { result, rerender, onAutoNavigateToClub } = renderAccessModel();
    await waitFor(() => expect(result.current.canAccessVault).toBe(true));
    await waitFor(() => expect(result.current.userClubs?.length).toBe(1));
    rerender({ currentView: rootView, activeClubFilter: "club-a" });
    expect(result.current.userClubs?.map(club => club.id)).toEqual(["club-a"]);
    expect(result.current.isLoadingClubs).toBe(false);
    await waitFor(() => expect(onAutoNavigateToClub).toHaveBeenCalledWith("club-a", "Club A"));
    rerender({ currentView: clubView, activeClubFilter: "club-a" });
    expect(result.current.userRoles).toEqual([{ role: "club_admin", club_id: "club-a", team_id: null }]);
    await waitFor(() => expect(result.current.currentClubHasPro).toBe(false));
    expect(result.current.canAccessVault).toBe(false);
    expect(fetchVaultUserRoles).toHaveBeenCalledTimes(1);
  });

  it("does not substitute another club when the selected club is absent from the loaded directory", async () => {
    featureRouting.icp = true;
    fetchVaultAccessibleClubs.mockImplementation(async (_user, _admin, _client, club) => club
      ? new Promise(() => {})
      : [{ id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 }]);
    const { result, rerender } = renderAccessModel();
    await waitFor(() => expect(result.current.userClubs?.length).toBe(1));
    rerender({ currentView: rootView, activeClubFilter: "club-b" });
    expect(result.current.userClubs).toBeUndefined();
    expect(result.current.isLoadingClubs).toBe(true);
    expect(result.current.canAccessVault).toBe(false);
  });

  it("ends a stalled admin directory after 35 seconds even when no member clubs exist", async () => {
    vi.useFakeTimers();
    featureRouting.icp = true;
    fetchVaultAppAdmin.mockResolvedValue(true);
    fetchVaultAccessibleClubs.mockImplementation(async (_user, admin) => admin ? new Promise(() => {}) : []);
    const { result } = renderAccessModel();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.canAccessVault).toBe(true);
    expect(result.current.isLoadingClubs).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(35_100); });
    expect(result.current.isLoadingClubs).toBe(false);
    expect(result.current.clubsError).toBeInstanceOf(Error);
    expect(fetchVaultAccessibleClubs).toHaveBeenCalledTimes(2);
  });

  it("keeps returned ICP member clubs visible while the wider admin directory stalls", async () => {
    featureRouting.icp = true;
    fetchVaultAppAdmin.mockResolvedValue(true);
    fetchVaultAccessibleClubs.mockImplementation(async (_user, admin) => admin
      ? new Promise(() => {})
      : [{ id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 }]);
    const { result } = renderAccessModel();
    await waitFor(() => expect(fetchVaultAccessibleClubs).toHaveBeenCalledWith("user-1", true));
    await waitFor(() => expect(result.current.userClubs?.map(c => c.id)).toEqual(["club-a"]));
    expect(result.current.isLoadingClubs).toBe(false);
    expect(result.current.clubsError).toBeNull();
  });

  it("settles a stalled ICP routing read after 12 seconds without automatic repeats, and supports retry", async () => {
    vi.useFakeTimers();
    featureRouting.icp = true;
    fetchVaultAccessibleClubs.mockReturnValue(new Promise(() => {}));
    const { result } = renderAccessModel();
    await act(async () => { await vi.advanceTimersByTimeAsync(12_100); });
    expect(result.current.isLoadingClubs).toBe(false);
    expect(result.current.clubsError).toBeInstanceOf(Error);
    expect(result.current.userClubs).toBeUndefined();
    expect(fetchVaultAccessibleClubs).toHaveBeenCalledTimes(1);
    fetchVaultAccessibleClubs.mockResolvedValue([{ id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 }]);
    await act(async () => { result.current.retryClubs(); await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.userClubs?.map(c => c.id)).toEqual(["club-a"]);
    expect(result.current.clubsError).toBeNull();
    expect(fetchVaultAccessibleClubs).toHaveBeenCalledTimes(2);
    expect(result.current.canAccessVault).toBe(false);
  });

  it("passes the resolved app-admin flag into the accessible-clubs fetch", async () => {
    fetchVaultAppAdmin.mockResolvedValue(true);
    renderAccessModel();
    await waitFor(() => expect(fetchVaultAccessibleClubs).toHaveBeenCalledWith("user-1", true));
  });

  it("starts member-only club discovery while app-admin lookup is still pending", async () => {
    fetchVaultAppAdmin.mockReturnValue(new Promise(() => {}));
    renderAccessModel();
    await waitFor(() => expect(fetchVaultAccessibleClubs).toHaveBeenCalledWith("user-1", false));
    expect(fetchVaultAccessibleClubs).not.toHaveBeenCalledWith("user-1", true);
  });
  it("opens an authorized club without waiting for app-admin lookup or all-club subscriptions", async () => {
    fetchVaultAppAdmin.mockReturnValue(new Promise(() => {}));
    fetchVaultUserRoles.mockResolvedValue([{ role: "coach", club_id: "club-a", team_id: null }]);
    fetchVaultClubHasPro.mockResolvedValue(true);
    fetchVaultAnyProAccess.mockReturnValue(new Promise(() => {}));
    const { result } = renderAccessModel({ currentView: clubView });
    await waitFor(() => expect(result.current.canAccessVault).toBe(true));
    expect(result.current.isLoadingAccess).toBe(false);
    expect(result.current.isAppAdmin).toBeUndefined();
    expect(fetchVaultAnyProAccess).toHaveBeenCalled();
  });
});
