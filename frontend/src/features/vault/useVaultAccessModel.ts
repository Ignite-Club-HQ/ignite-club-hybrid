import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FolderView } from "./useVaultExport";
import type { VaultRoleRecord } from "./types";
import {
  fetchVaultAccessibleClubs,
  fetchVaultAnyProAccess,
  fetchVaultClubHasPro,
  fetchVaultCompetitionAccess,
  fetchVaultTeamHasPro,
  fetchVaultUserRoles,
  type VaultClubSummary,
} from "./vaultAccessRepository";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import {
  canAccessVault as resolveCanAccessVault,
  getVaultAdminUpgradeInfo,
  getVaultTeamIds,
  hasVaultRoleAccess as resolveHasVaultRoleAccess,
  isVaultClubAdminOrCommittee,
  isVaultCoachOrTeamAdmin,
  resolveVaultContextPro,
} from "./vaultAccess";
import { withReadDeadline } from "@/live/readDeadline";
import { vaultKeys } from "./vaultQueryKeys";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

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
  isCompetitionVaultMember: boolean;
  isCompetitionVaultAdmin: boolean;
  isLoadingAccess: boolean;
  clubsError: unknown;
  retryClubs: () => void;
  accessError: unknown;
  retryAccess: () => void;
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
  const queryClient = useQueryClient();
  const { isAppAdmin: isAppAdminFromHook, isLoading: isLoadingAppAdminHook, error: appAdminError } = useIsAppAdmin();
  // Mirror the old raw query's `undefined` while the lookup is in flight so
  // every `isAppAdmin ?? false` / `!!isAppAdmin` call site keeps working.
  const isAppAdmin = !userId || isLoadingAppAdminHook ? undefined : isAppAdminFromHook;
  const isLoadingAppAdmin = !!userId && isLoadingAppAdminHook;
  const isIcpVault = isFeatureRoutedToIcp("vault");
  const selectedRoleClubId = isIcpVault
    ? (currentView.type === "root" ? activeClubFilter : currentView.clubId)
    : null;

  const { data: userRoles, isLoading: isLoadingRoles, error: rolesError, refetch: retryRoles } = useQuery({
    queryKey: ["user-admin-roles", userId, selectedRoleClubId],
    queryFn: async () => {
      if (!userId) return [];
      const roles = await withReadDeadline(selectedRoleClubId
        ? fetchVaultUserRoles(userId, undefined, selectedRoleClubId)
        : fetchVaultUserRoles(userId), "Vault roles");
      console.log("[Vault] Fetched userRoles for user", userId, ":", roles);
      return roles;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const hasVaultRoleAccess = useMemo(
    () => resolveHasVaultRoleAccess(isAppAdmin ?? false, userRoles),
    [isAppAdmin, userRoles],
  );

  // Each group is bounded inside the lookup, so a stuck group drops out on
  // its own instead of a whole-list cut-off failing every club.
  const { data: userClubs, isLoading: isLoadingClubs, error: clubsError, refetch: refetchClubs } = useQuery({
    queryKey: [...vaultKeys.clubsForUser(userId, activeClubFilter ? false : !!isAppAdmin), activeClubFilter ?? null, isIcpVault],
    queryFn: () => userId ? (activeClubFilter
      ? fetchVaultAccessibleClubs(userId, !!isAppAdmin, undefined, activeClubFilter)
      : fetchVaultAccessibleClubs(userId, !!isAppAdmin)) : [],
    // A member-scoped read is safe while the broader admin lookup runs.
    // Resolving admin=true starts its own separately keyed directory read.
    enabled: !!userId,
    staleTime: 60_000,
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

  const competitionId = currentView.type === "competition" ? currentView.competitionId : null;
  const { data: competitionAccess, isLoading: isLoadingCompetitionAccess, error: competitionError, refetch: retryCompetition } = useQuery({
    queryKey: ["vault-competition-access", userId, competitionId],
    queryFn: () => competitionId && userId ? withReadDeadline(fetchVaultCompetitionAccess(competitionId, userId), "Vault competition access") : null,
    enabled: !!userId && !!competitionId,
    staleTime: 30_000,
  });

  const contextClubId =
    currentView.type === "club" || currentView.type === "team" || currentView.type === "mini-league" || currentView.type === "competition"
      ? currentView.clubId
      : null;
  const selectedClub = isIcpVault && activeClubFilter
    ? userClubs?.find((club) => club.id === activeClubFilter)
    : undefined;
  // Only the exact selected ICP read carries authoritative media allowance.
  // Directory flags from the other paths are labels, not access evidence.
  const selectedClubsState = queryClient.getQueryState([
    ...vaultKeys.clubsForUser(userId, false), activeClubFilter ?? null, isIcpVault,
  ]);
  const selectedClubsUpdatedAt = selectedClubsState?.dataUpdatedAt ?? 0;
  const reusableSelectedClub = selectedClub && selectedClub.id === contextClubId &&
    !selectedClubsState?.isInvalidated && Date.now() - selectedClubsUpdatedAt < 30_000 ? selectedClub : undefined;

  // Check if the current club has Pro
  const { data: currentClubHasPro, isLoading: isLoadingClubHasPro, error: clubProError, refetch: retryClubPro } = useQuery({
    queryKey: [...vaultKeys.clubHasPro(contextClubId), userId, isIcpVault],
    queryFn: () => contextClubId ? withReadDeadline(fetchVaultClubHasPro(contextClubId), "Vault club subscription") : false,
    enabled: !!userId && contextClubId !== null,
    initialData: reusableSelectedClub?.is_pro,
    initialDataUpdatedAt: reusableSelectedClub ? selectedClubsUpdatedAt : undefined,
    staleTime: 30_000,
  });

  const contextTeamId = currentView.type === "team" ? currentView.teamId : null;

  // Check if the current team has Pro (for teams in non-Pro clubs)
  const { data: currentTeamHasPro, isLoading: isLoadingTeamHasPro, error: teamProError, refetch: retryTeamPro } = useQuery({
    queryKey: vaultKeys.teamHasPro(contextTeamId),
    queryFn: () => contextTeamId ? withReadDeadline(fetchVaultTeamHasPro(contextTeamId), "Vault team subscription") : false,
    enabled: contextTeamId !== null,
    staleTime: 30_000,
  });

  // Determine if current context has Pro access for uploads
  const currentContextHasPro = useMemo(
    () => resolveVaultContextPro(currentView, currentClubHasPro, currentTeamHasPro),
    [currentView, currentClubHasPro, currentTeamHasPro],
  );

  // Check for Pro subscription across every club/team the user holds a role
  // in (the root-view entitlement gate; distinct from `currentContextHasPro`).
  const { data: proAccessInfo, isLoading: isLoadingProClub, error: anyProError, refetch: retryAnyPro } = useQuery({
    queryKey: ["pro-access-info", userId],
    queryFn: () => userId ? withReadDeadline(fetchVaultAnyProAccess(userId), "Vault subscriptions") : false,
    // Other page consumers still use this for storage warning state;
    // scoped access never waits for it, but keep those consumers populated.
    enabled: !!userId,
    staleTime: 30_000,
  });

  const hasProClub = (selectedClub?.is_pro === true) || (proAccessInfo ?? false);

  // Vault access requires: 1) Pro subscription in current context AND 2) Admin/coach role
  const vaultAccessContextHasPro = currentView.type === "root" ? hasProClub : currentContextHasPro;

  const isCompetitionVaultMember = competitionId !== null && competitionAccess?.isMember === true;
  const isCompetitionVaultAdmin = competitionId !== null && competitionAccess?.canManage === true;
  const canAccessVault = currentView.type === "competition"
    ? currentContextHasPro && isCompetitionVaultMember
    : resolveCanAccessVault({
        isAppAdmin: isAppAdmin ?? false,
        hasRoleAccess: hasVaultRoleAccess,
        hasAnyPro: hasProClub,
        currentContextHasPro,
        isRoot: currentView.type === "root",
      });

  // An already-authorized scoped member does not need unrelated app-admin
  // discovery to finish. Pending checks still gate any unestablished access.
  const isLoadingAccess = !canAccessVault && (
    isLoadingAppAdmin || isLoadingRoles || (!isAppAdmin && (currentView.type === "root"
      ? isLoadingProClub
      : ((!currentContextHasPro && (isLoadingClubHasPro || isLoadingTeamHasPro)) || isLoadingCompetitionAccess)))
  );

  // Determine if it's a role issue or a Pro subscription issue
  const hasProButNoRole = currentView.type === "competition"
    ? vaultAccessContextHasPro && !isCompetitionVaultMember
    : vaultAccessContextHasPro && !hasVaultRoleAccess;

  const accessError = canAccessVault ? null : appAdminError || rolesError || (currentView.type === "root"
    ? anyProError
    : (!currentContextHasPro && (clubProError || teamProError)) || (competitionId && competitionError));
  const retryAccess = () => {
    void queryClient.refetchQueries({ queryKey: ["is-app-admin", userId], exact: true });
    void retryRoles();
    if (currentView.type === "root") void retryAnyPro();
    if (contextClubId) void retryClubPro();
    if (contextTeamId) void retryTeamPro();
    if (competitionId) void retryCompetition();
  };

  return {
    accessError, retryAccess,
    clubsError: userClubs?.length ? null : clubsError,
    retryClubs: () => { void refetchClubs(); },
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
    isCompetitionVaultMember,
    isCompetitionVaultAdmin,
    isLoadingAccess,
  };
}
