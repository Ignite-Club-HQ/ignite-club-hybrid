import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FolderView } from "./useVaultExport";
import type { VaultRoleRecord } from "./types";
import {
  fetchVaultAccessibleClubs,
  fetchVaultAnyProAccess,
  fetchVaultAppAdmin,
  fetchVaultClubHasPro,
  fetchVaultTeamHasPro,
  fetchVaultUserRoles,
  type VaultClubSummary,
} from "./vaultAccessRepository";
import {
  canAccessVault as resolveCanAccessVault,
  getVaultAdminUpgradeInfo,
  getVaultTeamIds,
  hasVaultRoleAccess as resolveHasVaultRoleAccess,
  isVaultClubAdminOrCommittee,
  isVaultCoachOrTeamAdmin,
  resolveVaultContextPro,
} from "./vaultAccess";
import { vaultKeys } from "./vaultQueryKeys";

export type { VaultClubSummary } from "./vaultAccessRepository";

export interface VaultAdminUpgradeInfo {
  clubId: string | undefined;
  teamId: string | undefined;
}

export interface UseVaultAccessModelOptions {
  userId: string | undefined;
  /** Owned by the page — also driven by URL/query-param deep links and the
   * root club/team/mini-league picker, so this hook only reads it. */
  currentView: FolderView;
  /** The club-scoped theme filter from `useClubTheme()`, read by the page. */
  activeClubFilter: string | null | undefined;
  /** Called once, at most, when the root view should auto-navigate into a
   * Pro club matching `activeClubFilter`. The page owns `currentView` and
   * decides how to apply the transition (e.g. `setCurrentView`). */
  onAutoNavigateToClub: (clubId: string, clubName: string) => void;
}

export interface UseVaultAccessModelResult {
  /** `true`/`false` once resolved, `undefined` while the app-admin lookup is
   * in flight. Mirrors the raw `["is-app-admin", userId]` query result so
   * every `isAppAdmin ?? false` / `!!isAppAdmin` call site keeps working. */
  isAppAdmin: boolean | undefined;
  userRoles: VaultRoleRecord[] | undefined;
  hasVaultRoleAccess: boolean;
  userClubs: VaultClubSummary[] | undefined;
  isLoadingClubs: boolean;
  /** Club admin or committee member in the active club (or an app admin,
   * anywhere). Aliased from `isVaultClubAdminOrCommittee` for call-site
   * brevity, matching the page's pre-extraction alias. */
  isClubAdmin: boolean;
  isCoachOrTeamAdmin: boolean;
  adminUpgradeInfo: VaultAdminUpgradeInfo;
  userTeamIds: string[];
  currentClubHasPro: boolean | undefined;
  currentTeamHasPro: boolean | undefined;
  currentContextHasPro: boolean;
  /** Whether the user has Pro access to ANY club/team they hold a role in —
   * the root-view entitlement check (distinct from `currentContextHasPro`,
   * which is scoped to the active club/team/mini-league). */
  hasProClub: boolean;
  canAccessVault: boolean;
  hasProButNoRole: boolean;
  isLoadingAccess: boolean;
}

/**
 * Owns Vault's access/entitlement/root-navigation data model: app-admin and
 * role lookups, the eligible-clubs list and its once-only root auto-navigation
 * effect, current-context Pro entitlement, and the derived
 * `canAccessVault`/`hasProButNoRole`/loading-gate values the page renders
 * from. `currentView` stays page-owned (it is also driven by URL/query-param
 * deep links and the root picker) — this hook only reads it and reports back
 * through `onAutoNavigateToClub` rather than owning a setter.
 *
 * Vault content, storage, search, and workflow/mutation concerns are
 * deliberately out of scope here; several of their queries (e.g. the club
 * teams list) still read this hook's `isClubAdmin`, `userTeamIds`, and
 * `currentClubHasPro` outputs, so those stay part of the typed contract even
 * though the queries that consume them remain in the page.
 */
export function useVaultAccessModel({
  userId,
  currentView,
  activeClubFilter,
  onAutoNavigateToClub,
}: UseVaultAccessModelOptions): UseVaultAccessModelResult {
  const { data: isAppAdmin, isLoading: isLoadingAppAdmin } = useQuery({
    queryKey: ["is-app-admin", userId],
    queryFn: () => fetchVaultAppAdmin(userId!),
    enabled: !!userId,
  });

  const { data: userRoles, isLoading: isLoadingRoles } = useQuery({
    queryKey: ["user-admin-roles", userId],
    queryFn: async () => {
      const roles = await fetchVaultUserRoles(userId!);
      console.log("[Vault] Fetched userRoles for user", userId, ":", roles);
      return roles;
    },
    enabled: !!userId,
  });

  const hasVaultRoleAccess = useMemo(
    () => resolveHasVaultRoleAccess(isAppAdmin ?? false, userRoles),
    [isAppAdmin, userRoles],
  );

  const { data: userClubs, isLoading: isLoadingClubs } = useQuery({
    queryKey: vaultKeys.clubsForUser(userId, isAppAdmin),
    queryFn: () => fetchVaultAccessibleClubs(userId!, !!isAppAdmin),
    enabled: !!userId && isAppAdmin !== undefined,
  });

  // Auto-navigate to club view when theme filter is active - only on initial load
  const hasAutoNavigatedRef = useRef(false);
  useEffect(() => {
    if (
      activeClubFilter &&
      currentView.type === "root" &&
      userClubs &&
      userClubs.length > 0 &&
      !hasAutoNavigatedRef.current
    ) {
      const club = userClubs.find((c) => c.id === activeClubFilter);
      if (club && club.is_pro) {
        hasAutoNavigatedRef.current = true;
        onAutoNavigateToClub(activeClubFilter, club.name);
      }
    }
  }, [activeClubFilter, userClubs, currentView.type, onAutoNavigateToClub]);

  // Check if user is a club admin or committee member for the current club (can see all teams)
  const isClubAdmin = useMemo(
    () => isVaultClubAdminOrCommittee(isAppAdmin ?? false, currentView, userRoles),
    [isAppAdmin, currentView, userRoles],
  );

  // Check if user is a coach or team admin in the current club (can see club-level chat folders)
  const isCoachOrTeamAdmin = useMemo(
    () => isVaultCoachOrTeamAdmin(isClubAdmin, currentView, userRoles),
    [isClubAdmin, currentView, userRoles],
  );

  // Get first admin club/team for upgrade link
  const adminUpgradeInfo = useMemo(() => getVaultAdminUpgradeInfo(userRoles), [userRoles]);

  // Get teams user has access to
  const userTeamIds = useMemo(() => getVaultTeamIds(userRoles), [userRoles]);

  const contextClubId =
    currentView.type === "club" || currentView.type === "team" || currentView.type === "mini-league"
      ? currentView.clubId
      : null;

  // Check if the current club has Pro
  const { data: currentClubHasPro, isLoading: isLoadingClubHasPro } = useQuery({
    queryKey: vaultKeys.clubHasPro(contextClubId),
    queryFn: () => fetchVaultClubHasPro(contextClubId!),
    enabled: contextClubId !== null,
  });

  const contextTeamId = currentView.type === "team" ? currentView.teamId : null;

  // Check if the current team has Pro (for teams in non-Pro clubs)
  const { data: currentTeamHasPro, isLoading: isLoadingTeamHasPro } = useQuery({
    queryKey: vaultKeys.teamHasPro(contextTeamId),
    queryFn: () => fetchVaultTeamHasPro(contextTeamId!),
    enabled: contextTeamId !== null,
  });

  // Determine if current context has Pro access for uploads
  const currentContextHasPro = useMemo(
    () => resolveVaultContextPro(currentView, currentClubHasPro, currentTeamHasPro),
    [currentView, currentClubHasPro, currentTeamHasPro],
  );

  // Check for Pro subscription across every club/team the user holds a role
  // in (the root-view entitlement gate; distinct from `currentContextHasPro`).
  const { data: proAccessInfo, isLoading: isLoadingProClub } = useQuery({
    queryKey: ["pro-access-info", userId],
    queryFn: () => fetchVaultAnyProAccess(userId!),
    enabled: !!userId,
  });

  const hasProClub = proAccessInfo ?? false;

  const isLoadingAccess =
    isLoadingAppAdmin || isLoadingProClub || isLoadingRoles || isLoadingClubHasPro || isLoadingTeamHasPro;

  // Vault access requires: 1) Pro subscription in current context AND 2) Admin/coach role
  const vaultAccessContextHasPro = currentView.type === "root" ? hasProClub : currentContextHasPro;

  const canAccessVault = resolveCanAccessVault({
    isAppAdmin: isAppAdmin ?? false,
    hasRoleAccess: hasVaultRoleAccess,
    hasAnyPro: hasProClub,
    currentContextHasPro,
    isRoot: currentView.type === "root",
  });

  // Determine if it's a role issue or a Pro subscription issue
  const hasProButNoRole = vaultAccessContextHasPro && !hasVaultRoleAccess;

  return {
    isAppAdmin,
    userRoles,
    hasVaultRoleAccess,
    userClubs,
    isLoadingClubs,
    isClubAdmin,
    isCoachOrTeamAdmin,
    adminUpgradeInfo,
    userTeamIds,
    currentClubHasPro,
    currentTeamHasPro,
    currentContextHasPro,
    hasProClub,
    canAccessVault,
    hasProButNoRole,
    isLoadingAccess,
  };
}
