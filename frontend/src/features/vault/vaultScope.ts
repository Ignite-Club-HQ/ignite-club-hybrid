import type {
  VaultFolderView,
  VaultFolderVisibilityRecord,
  VaultRoleRecord,
  VaultScope,
} from "./types";

export const GENERIC_CHAT_FOLDER_NAMES = ["Chat Images", "Chat Links"] as const;

export function getVaultScope(view: VaultFolderView): VaultScope {
  if (view.type === "root") {
    return { clubId: null, teamId: null, miniLeagueId: null, folderId: null };
  }

  return {
    clubId: view.clubId,
    teamId: view.type === "team" ? view.teamId : null,
    miniLeagueId: view.type === "mini-league" ? view.miniLeagueId : null,
    folderId: view.folderId ?? null,
  };
}

export function collectVaultClubRoles(
  roles: readonly VaultRoleRecord[] | null | undefined,
  clubId: string | null,
): Set<string> {
  if (!clubId || !roles) return new Set();

  return new Set(
    roles
      .filter((record) => record.club_id === clubId && record.role)
      .map((record) => record.role as string),
  );
}

export function filterVisibleVaultFolders<T extends VaultFolderVisibilityRecord>(
  folders: readonly T[],
  options: {
    isPrivilegedViewer: boolean;
    restrictClubRootToChatFolders: boolean;
    clubRoles: ReadonlySet<string>;
  },
): T[] {
  const roleVisible = folders.filter((folder) => {
    if (!folder.restricted_roles?.length) return true;
    if (options.isPrivilegedViewer) return true;
    return folder.restricted_roles.some((role) => options.clubRoles.has(role));
  });

  if (!options.restrictClubRootToChatFolders) {
    return roleVisible;
  }

  return roleVisible.filter(
    (folder) =>
      GENERIC_CHAT_FOLDER_NAMES.includes(
        folder.name as (typeof GENERIC_CHAT_FOLDER_NAMES)[number],
      ) || Boolean(folder.restricted_roles?.length),
  );
}

export function abbreviateVaultOrganisationName(name: string): string {
  if (!name) return name;

  return name
    .replace(/\bSoccer Club\b/gi, "SC")
    .replace(/\bFootball Club\b/gi, "FC")
    .replace(/\bBasketball Club\b/gi, "BC")
    .replace(/\bNetball Club\b/gi, "NC")
    .replace(/\bRugby Club\b/gi, "RC")
    .replace(/\bCricket Club\b/gi, "CC")
    .replace(/\bTennis Club\b/gi, "TC")
    .replace(/\bHockey Club\b/gi, "HC")
    .replace(/\bAthletic Club\b/gi, "AC")
    .replace(/\bSports Club\b/gi, "SC")
    .trim();
}
