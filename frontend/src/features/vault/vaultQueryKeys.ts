import type { QueryClient } from "@tanstack/react-query";
import type { VaultFolderView } from "./types";

export const vaultKeys = {
  clubs: () => ["vault-clubs"] as const,
  clubsForUser: (userId: string | undefined, isAppAdmin: boolean | undefined) =>
    ["vault-clubs", userId, isAppAdmin] as const,
  clubHasPro: (clubId: string | null) => ["vault-club-has-pro", clubId] as const,
  teamHasPro: (teamId: string | null) => ["vault-team-has-pro", teamId] as const,
  clubTeams: () => ["vault-club-teams"] as const,
  clubTeamsForAccess: (
    clubId: string | null,
    isClubAdmin: boolean,
    teamIds: readonly string[],
    clubHasPro: boolean | undefined,
  ) => ["vault-club-teams", clubId, isClubAdmin, teamIds, clubHasPro] as const,
  teamFolders: () => ["vault-team-folders"] as const,
  teamFoldersForClub: (clubId: string | null) => ["vault-team-folders", clubId] as const,
  clubMiniLeagues: () => ["vault-club-mini-leagues"] as const,
  clubMiniLeaguesForAccess: (
    clubId: string | null,
    isClubAdmin: boolean,
    userId: string | undefined,
    roleCount: number | undefined,
  ) => ["vault-club-mini-leagues", clubId, isClubAdmin, userId, roleCount] as const,
  subfolders: () => ["vault-subfolders"] as const,
  subfoldersForView: (
    view: VaultFolderView,
    isClubAdmin: boolean,
    isCoachOrTeamAdmin: boolean,
    isAppAdmin: boolean | undefined,
    clubRoleSignature: string,
  ) => [
    "vault-subfolders",
    view,
    isClubAdmin,
    isCoachOrTeamAdmin,
    isAppAdmin,
    clubRoleSignature,
  ] as const,
  files: () => ["vault-files"] as const,
  filesForView: (
    view: VaultFolderView,
    isClubAdmin: boolean,
    isCoachOrTeamAdmin: boolean,
  ) => ["vault-files", view, isClubAdmin, isCoachOrTeamAdmin] as const,
  folders: () => ["vault-folders"] as const,
  trash: () => ["vault-trash"] as const,
  trashForClub: (clubId: string | null) => ["vault-trash", clubId] as const,
  folderTree: (
    scopeType: VaultFolderView["type"],
    clubId: string | null,
    teamId: string | null,
    isClubAdmin: boolean,
    isAppAdmin: boolean | undefined,
    clubRoleSignature: string,
  ) => [
    "vault-folder-tree",
    scopeType,
    clubId,
    teamId,
    isClubAdmin,
    isAppAdmin,
    clubRoleSignature,
  ] as const,
  recursiveSearch: (
    scope: unknown,
    normalizedQuery: string,
    isClubAdmin: boolean,
    isCoachOrTeamAdmin: boolean,
    clubRoleSignature: string,
  ) => [
    "vault-recursive-search",
    scope,
    normalizedQuery,
    isClubAdmin,
    isCoachOrTeamAdmin,
    clubRoleSignature,
  ] as const,
  storageBreakdown: () => ["storage-breakdown"] as const,
  storageBreakdownForClub: (clubId: string | undefined) =>
    ["storage-breakdown", clubId] as const,
  photos: () => ["photos"] as const,
  clubFreeUsage: () => ["club-free-usage"] as const,
};


export type VaultCacheScope =
  | "clubs"
  | "files"
  | "folders"
  | "subfolders"
  | "trash"
  | "storageBreakdown"
  | "photos"
  | "clubFreeUsage";

const vaultInvalidationKeys: Record<VaultCacheScope, readonly string[]> = {
  clubs: vaultKeys.clubs(),
  files: vaultKeys.files(),
  folders: vaultKeys.folders(),
  subfolders: vaultKeys.subfolders(),
  trash: vaultKeys.trash(),
  storageBreakdown: vaultKeys.storageBreakdown(),
  photos: vaultKeys.photos(),
  clubFreeUsage: vaultKeys.clubFreeUsage(),
};

export function invalidateVaultCache(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  scopes: readonly VaultCacheScope[],
): void {
  for (const scope of scopes) {
    void queryClient.invalidateQueries({ queryKey: vaultInvalidationKeys[scope] });
  }
}
