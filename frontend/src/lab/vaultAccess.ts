import type {
  VaultFolderView,
  VaultRoleRecord,
  VaultSubscriptionRecord,
} from "./vaultAccessTypes";

const VAULT_ACCESS_ROLES = new Set([
  "club_admin",
  "team_admin",
  "coach",
  "league_admin",
  "committee_member",
]);

export function hasVaultRoleAccess(
  isAppAdmin: boolean,
  roles: readonly VaultRoleRecord[] | null | undefined,
): boolean {
  if (isAppAdmin) return true;
  return roles?.some((record) => Boolean(record.role && VAULT_ACCESS_ROLES.has(record.role))) ?? false;
}

function activeClubId(view: VaultFolderView): string | null {
  return view.type === "root" ? null : view.clubId;
}

export function isVaultClubAdminOrCommittee(
  isAppAdmin: boolean,
  view: VaultFolderView,
  roles: readonly VaultRoleRecord[] | null | undefined,
): boolean {
  if (isAppAdmin) return true;
  const clubId = activeClubId(view);
  if (!clubId) return false;
  return roles?.some(
    (record) =>
      record.club_id === clubId &&
      (record.role === "club_admin" || record.role === "committee_member"),
  ) ?? false;
}

export function isVaultCoachOrTeamAdmin(
  isClubAdmin: boolean,
  view: VaultFolderView,
  roles: readonly VaultRoleRecord[] | null | undefined,
): boolean {
  if (isClubAdmin) return true;
  const clubId = activeClubId(view);
  if (!clubId) return false;
  return roles?.some(
    (record) =>
      record.club_id === clubId &&
      (record.role === "coach" || record.role === "team_admin"),
  ) ?? false;
}

export function getVaultAdminUpgradeInfo(
  roles: readonly VaultRoleRecord[] | null | undefined,
): { clubId: string | undefined; teamId: string | undefined } {
  const clubAdmin = roles?.find(
    (record) => record.role === "club_admin" && record.club_id,
  );
  if (clubAdmin?.club_id) {
    return { clubId: clubAdmin.club_id, teamId: undefined };
  }

  const teamAdmin = roles?.find(
    (record) => record.role === "team_admin" && record.team_id,
  );
  if (teamAdmin?.team_id) {
    return { clubId: undefined, teamId: teamAdmin.team_id };
  }

  return { clubId: undefined, teamId: undefined };
}

export function getVaultTeamIds(
  roles: readonly VaultRoleRecord[] | null | undefined,
): string[] {
  return roles?.flatMap((record) => record.team_id ? [record.team_id] : []) ?? [];
}

// Merges club ids reached through team membership into an already-resolved
// list of directly-assigned club ids, skipping falsy entries and any club id
// already present so the result stays deduplicated and keeps its original
// (direct-roles-first) ordering.
export function mergeVaultTeamClubIds(
  clubIds: readonly string[],
  teamClubIds: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  const merged = [...clubIds];
  for (const clubId of teamClubIds ?? []) {
    if (clubId && !merged.includes(clubId)) merged.push(clubId);
  }
  return merged;
}

// Resolves the club ids visible to a non-app-admin Vault user: direct
// `user_roles.club_id` rows (deduplicated) unioned with any club ids reached
// through team membership. `teamClubIds` is the result of the caller's own
// `teams.club_id` lookup for `getVaultTeamIds(roles)` - this stays a pure
// merge step so the Supabase-specific team lookup itself is left untouched
// in the page. An app admin never reaches this path (the page short-circuits
// to an unfiltered club fetch before calling it), so there is no admin
// branch here.
export function resolveVaultVisibleClubIds(
  roles: readonly VaultRoleRecord[] | null | undefined,
  teamClubIds?: readonly (string | null | undefined)[] | null,
): string[] {
  if (!roles || roles.length === 0) return [];
  const directClubIds = [...new Set(roles.map((record) => record.club_id).filter(Boolean))] as string[];
  return mergeVaultTeamClubIds(directClubIds, teamClubIds);
}

export function hasVaultProEntitlement(
  subscription: VaultSubscriptionRecord | null | undefined,
): boolean {
  return Boolean(
    subscription?.is_pro ||
    subscription?.is_pro_football ||
    subscription?.admin_pro_override ||
    subscription?.admin_pro_football_override,
  );
}

export function resolveVaultContextPro(
  view: VaultFolderView,
  clubHasPro: boolean | null | undefined,
  teamHasPro: boolean | null | undefined,
): boolean {
  if (view.type === "team") return Boolean(clubHasPro || teamHasPro);
  if (view.type === "club" || view.type === "mini-league") return Boolean(clubHasPro);
  return false;
}

export function canAccessVault(options: {
  isAppAdmin: boolean;
  hasRoleAccess: boolean;
  hasAnyPro: boolean;
  currentContextHasPro: boolean;
  isRoot: boolean;
}): boolean {
  const contextHasPro = options.isRoot ? options.hasAnyPro : options.currentContextHasPro;
  return (options.isAppAdmin || contextHasPro) && options.hasRoleAccess;
}
