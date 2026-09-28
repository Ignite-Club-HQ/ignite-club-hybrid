/**
 * Contract tests for `useVaultAccessModel` — the access/entitlement/root-
 * navigation data model extracted from `VaultPage`. Exercises the actual
 * composed React Query + effect behaviour (not just source-string matches),
 * since this is a higher-risk data-model extraction than the prior
 * workflow/presentation splits.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useVaultAccessModel } from "./useVaultAccessModel";
import type { FolderView } from "./useVaultExport";
import type { VaultClubSummary } from "./vaultAccessRepository";

const fetchVaultAppAdmin = vi.fn<(userId: string) => Promise<boolean>>();
const fetchVaultUserRoles = vi.fn<(userId: string) => Promise<any[]>>();
const fetchVaultAccessibleClubs = vi.fn<(userId: string, isAppAdmin: boolean) => Promise<VaultClubSummary[]>>();
const fetchVaultClubHasPro = vi.fn<(clubId: string) => Promise<boolean>>();
const fetchVaultTeamHasPro = vi.fn<(teamId: string) => Promise<boolean>>();
const fetchVaultAnyProAccess = vi.fn<(userId: string) => Promise<boolean>>();

vi.mock("./vaultAccessRepository", () => ({
  fetchVaultAppAdmin: (...args: [string]) => fetchVaultAppAdmin(...args),
  fetchVaultUserRoles: (...args: [string]) => fetchVaultUserRoles(...args),
  fetchVaultAccessibleClubs: (...args: [string, boolean]) => fetchVaultAccessibleClubs(...args),
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
  fetchVaultAppAdmin.mockReset().mockResolvedValue(false);
  fetchVaultUserRoles.mockReset().mockResolvedValue([]);
  fetchVaultAccessibleClubs.mockReset().mockResolvedValue([]);
  fetchVaultClubHasPro.mockReset().mockResolvedValue(false);
  fetchVaultTeamHasPro.mockReset().mockResolvedValue(false);
  fetchVaultAnyProAccess.mockReset().mockResolvedValue(false);
});

describe("useVaultAccessModel — access decision", () => {
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
  it("passes the resolved app-admin flag into the accessible-clubs fetch", async () => {
    fetchVaultAppAdmin.mockResolvedValue(true);
    renderAccessModel();
    await waitFor(() => expect(fetchVaultAccessibleClubs).toHaveBeenCalledWith("user-1", true));
  });

  it("does not fetch accessible clubs until the app-admin lookup resolves", () => {
    fetchVaultAppAdmin.mockReturnValue(new Promise(() => {}));
    renderAccessModel();
    expect(fetchVaultAccessibleClubs).not.toHaveBeenCalled();
  });
});
