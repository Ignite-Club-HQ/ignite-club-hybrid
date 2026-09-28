import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fuzzyFilter } from "@/lib/fuzzySearch";
import { isVaultImageItem } from "./vaultItemClassification";
import type { VaultFolderView, VaultRoleRecord } from "./types";
import { collectVaultClubRoles, getVaultScope } from "./vaultScope";
import {
  fetchVaultFolderTree,
  fetchVaultItems,
  fetchVaultSubfolders,
  partitionVaultItems,
  searchVaultContents,
  type VaultFileRow,
  type VaultFolderRow,
  type VaultFolderTree,
  type VaultPhotoItem,
  type VaultSearchFile,
  type VaultSearchFolder,
} from "./vaultReadRepository";
import { vaultKeys } from "./vaultQueryKeys";

export type {
  VaultFileRow,
  VaultFolderRow,
  VaultPhotoItem,
  VaultSearchFile,
  VaultSearchFolder,
} from "./vaultReadRepository";

const EMPTY_FOLDER_TREE: VaultFolderTree = {
  descendants: [],
  pathById: new Map(),
  descendantIds: [],
};

export interface UseVaultContentDataModelOptions {
  currentView: VaultFolderView;
  /** Page-owned trash toggle. Gates the active-content and recursive-search
   * queries (both must stay off while the trash view is showing) but the
   * trash workflow itself (its own queries/mutations) stays page-owned. */
  showTrash: boolean;
  vaultSearchQuery: string;
  debouncedVaultSearchQuery: string;
  isClubAdmin: boolean;
  isCoachOrTeamAdmin: boolean;
  isAppAdmin: boolean | undefined;
  userRoles: VaultRoleRecord[] | undefined;
}

export interface UseVaultContentDataModelResult {
  /** Raw, unfiltered folders in the current view (used for counts and as
   * the non-recursive search source). */
  subfolders: VaultFolderRow[] | undefined;
  /** Raw `vault_files` rows for the current view, before photo/file split. */
  vaultItems: VaultFileRow[] | undefined;
  /** `vaultItems` classified as images, with photo-compatibility fields. */
  photos: VaultPhotoItem[];
  /** `vaultItems` classified as non-images. */
  files: VaultFileRow[];
  /** Trimmed `vaultSearchQuery` (not debounced) used for fuzzy highlighting. */
  normalizedSearch: string;
  /** True once a debounced, non-empty search query is active outside trash. */
  recursiveEnabled: boolean;
  isFetchingRecursive: boolean;
  displaySubfolders: Array<VaultFolderRow | VaultSearchFolder>;
  displayPhotos: Array<VaultPhotoItem | VaultSearchFile>;
  displayFiles: Array<VaultFileRow | VaultSearchFile>;
}

/**
 * Owns the Vault content/search data model: the active-view folders and
 * files, their photo/file classification, and the recursive (subfolder-
 * spanning) search used whenever a query is active. Reuses the previously
 * unused (already fully tested) `vaultReadRepository`/`vaultScope` modules
 * instead of duplicating their query/filtering logic a second time, mirroring
 * the access-model extraction's `vaultAccessRepository`/`vaultAccess` reuse.
 *
 * `currentView` and `showTrash` stay page-owned state; this hook only reads
 * them. Storage, workflow hooks (upload/Drive/export/bulk-delete/folder
 * management/trash), mutations, and presentation stay in `VaultPage`.
 */
export function useVaultContentDataModel({
  currentView,
  showTrash,
  vaultSearchQuery,
  debouncedVaultSearchQuery,
  isClubAdmin,
  isCoachOrTeamAdmin,
  isAppAdmin,
  userRoles,
}: UseVaultContentDataModelOptions): UseVaultContentDataModelResult {
  // Roles the current user holds in the active club (used to filter
  // role-restricted chat folders like "Coaches Chat", "Club Admin Chat", etc.)
  const userClubRoleSet = useMemo(
    () => collectVaultClubRoles(userRoles, getVaultScope(currentView).clubId),
    [userRoles, currentView],
  );
  const clubRoleSignature = useMemo(
    () => Array.from(userClubRoleSet).sort().join(","),
    [userClubRoleSet],
  );

  const { data: subfolders } = useQuery({
    queryKey: vaultKeys.subfoldersForView(
      currentView,
      isClubAdmin,
      isCoachOrTeamAdmin,
      isAppAdmin,
      clubRoleSignature,
    ),
    queryFn: () =>
      fetchVaultSubfolders({
        view: currentView,
        isAppAdmin: isAppAdmin ?? false,
        isClubAdmin,
        isCoachOrTeamAdmin,
        clubRoles: userClubRoleSet,
      }),
    enabled: currentView.type !== "root",
  });

  // Vault now reads all content from vault_files table only
  // Photos uploaded via Media page are also added to vault_files
  // Photos uploaded directly to Vault stay in vault_files only (not in photos table)
  const { data: vaultItems } = useQuery({
    queryKey: vaultKeys.filesForView(currentView, isClubAdmin, isCoachOrTeamAdmin),
    queryFn: () =>
      fetchVaultItems({ view: currentView, isClubAdmin, isCoachOrTeamAdmin }),
    enabled: currentView.type !== "root" && !showTrash,
  });

  // Separate vault items into photos and files using the shared classifier
  const { photos, files } = useMemo(() => partitionVaultItems(vaultItems), [vaultItems]);

  // Recursive search - always search inside subfolders when a query is active.
  // Performance strategy:
  //  - Debounce the query so we don't re-fetch on every keystroke.
  //  - Cache the folder tree per scope (no query in its key) so paths are
  //    available instantly across searches.
  //  - Push the name filter to Postgres via ilike so the payload only
  //    contains matches, not the entire vault.
  const recursiveEnabled =
    debouncedVaultSearchQuery.trim().length > 0 && currentView.type !== "root" && !showTrash;
  const recursiveScope = useMemo(() => {
    const scope = getVaultScope(currentView);
    return {
      type: currentView.type,
      clubId: scope.clubId,
      teamId: scope.teamId,
      miniLeagueId: scope.miniLeagueId,
      startFolderId: scope.folderId,
    };
  }, [currentView]);

  // Folder tree cache (per scope) — used for path display and descendant set.
  const { data: folderTree } = useQuery({
    queryKey: vaultKeys.folderTree(
      recursiveScope.type,
      recursiveScope.clubId,
      recursiveScope.teamId,
      isClubAdmin,
      isAppAdmin,
      clubRoleSignature,
    ),
    queryFn: () =>
      fetchVaultFolderTree({
        view: currentView,
        isPrivilegedViewer: (isAppAdmin ?? false) || isClubAdmin,
        clubRoles: userClubRoleSet,
      }),
    enabled: recursiveScope.type === "club" || recursiveScope.type === "team",
    staleTime: 60_000,
  });

  const { data: recursiveData, isFetching: isFetchingRecursive } = useQuery({
    queryKey: vaultKeys.recursiveSearch(
      recursiveScope,
      debouncedVaultSearchQuery.trim().toLowerCase(),
      isClubAdmin,
      isCoachOrTeamAdmin,
      clubRoleSignature,
    ),
    queryFn: () =>
      searchVaultContents({
        view: currentView,
        searchQuery: debouncedVaultSearchQuery,
        tree: folderTree ?? EMPTY_FOLDER_TREE,
      }),
    enabled: recursiveEnabled && !!folderTree,
    keepPreviousData: true,
    staleTime: 30_000,
  } as any);

  // Search filtering across folders, photos, and files (fuzzy + ranked)
  const normalizedSearch = vaultSearchQuery.trim();
  const recursiveResult = recursiveData as
    | { folders: VaultSearchFolder[]; files: VaultSearchFile[] }
    | undefined;
  const searchSourceFolders: Array<VaultFolderRow | VaultSearchFolder> = recursiveEnabled
    ? recursiveResult?.folders || []
    : subfolders || [];
  // The recursive search's file rows already carry `image_url`/`uploader_id`/
  // `title`/`folder_path` (added by `searchVaultContents`), so photo/file
  // classification here is a plain filter, not a re-partition.
  const searchSourcePhotos: Array<VaultPhotoItem | VaultSearchFile> = recursiveEnabled
    ? (recursiveResult?.files || []).filter(isVaultImageItem)
    : photos || [];
  const searchSourceFiles: Array<VaultFileRow | VaultSearchFile> = recursiveEnabled
    ? (recursiveResult?.files || []).filter((f) => !isVaultImageItem(f))
    : files || [];
  const displaySubfolders = useMemo(() => {
    return fuzzyFilter(searchSourceFolders, normalizedSearch, (f) => f.name || "");
  }, [searchSourceFolders, normalizedSearch]);
  const displayPhotos = useMemo(() => {
    return fuzzyFilter(searchSourcePhotos, normalizedSearch, (p) => p.title || "");
  }, [searchSourcePhotos, normalizedSearch]);
  const displayFiles = useMemo(() => {
    return fuzzyFilter(searchSourceFiles, normalizedSearch, (f) => f.name || "");
  }, [searchSourceFiles, normalizedSearch]);

  return {
    subfolders,
    vaultItems,
    photos,
    files,
    normalizedSearch,
    recursiveEnabled,
    isFetchingRecursive,
    displaySubfolders,
    displayPhotos,
    displayFiles,
  };
}
