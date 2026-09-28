import type {
  VaultFolderView,
  VaultRoleRecord,
  VaultSubscriptionRecord,
} from "./types";

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
