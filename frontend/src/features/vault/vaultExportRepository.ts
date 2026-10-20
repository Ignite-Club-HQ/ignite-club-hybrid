/**
 * Vault recursive-export repository.
 *
 * Invariants:
 *  1. `vault_files` is the ONLY item source. `public.photos` is never queried
 *     here — gallery photos reach the Vault via one-way mirroring into
 *     `vault_files` ("Gallery Uploads"), so reading both would duplicate rows
 *     and surface media-gallery rows that are not visible in the Vault.
 *  2. Soft-deleted rows (`deleted_at IS NOT NULL`) are excluded.
 *  3. Scope fails closed: with neither `clubId` nor `teamId` we perform ZERO
 *     database queries and return an empty result rather than exporting every
 *     club the user can read via RLS.
 */
import { supabase as defaultClient } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { isVaultImageItem } from "./vaultItemClassification";
import { mapLiveVaultFile, mapLiveVaultFolder, unwrapLiveVaultFileWithFolder, resolveCompetitionVaultFileUrls } from "./vaultReadRepository";

type Client = typeof defaultClient;

export interface VaultExportScope {
  folderId: string | null;
  clubId: string | null;
  teamId: string | null;
  competitionId?: string | null;
}

export interface VaultFolderContents {
  photos: any[];
  files: any[];
  subfolders: { folder: any; path: string }[];
}

export interface VaultExportContents {
  photos: any[];
  files: any[];
  subfolders: { folder: any; path: string }[];
  folderBreakdown: { path: string; photoCount: number; fileCount: number }[];
}

export const hasVaultExportScope = (scope: {
  clubId: string | null;
  teamId: string | null;
  competitionId?: string | null;
}) => Boolean(scope.teamId || scope.competitionId || scope.clubId);

const applyScope = (query: any, clubId: string | null, teamId: string | null, competitionId: string | null = null) => {
  if (teamId) return query.eq("team_id", teamId);
  if (competitionId) return query.eq("club_id", clubId).eq("competition_id", competitionId);
  return query.eq("club_id", clubId).is("team_id", null).is("competition_id", null);
};

/** Map a `vault_files` image row to the photo-like shape the export UI expects. */
const toPhotoShape = (row: any, path: string) => ({
  ...row,
  path,
  image_url: row.file_url,
  uploader_id: row.uploaded_by,
  title: row.name,
});

const toLiveFolderContents = (
  all: any[],
  childFolders: any[],
  path: string,
): VaultFolderContents => ({
  photos: all.filter(isVaultImageItem).map(r => toPhotoShape(r, path)),
  files: all.filter(r => !isVaultImageItem(r)).map(f => ({ ...f, path })),
  subfolders: childFolders.map(folder => ({
    folder,
    path: path ? `${path}/${folder.name}` : folder.name,
  })),
});

export const fetchVaultFolderContents = async (
  { folderId, clubId, teamId, competitionId = null }: VaultExportScope,
  path: string = "",
  client: Client = defaultClient,
): Promise<VaultFolderContents> => {
  // Fail closed — no scope means no export.
  if (!hasVaultExportScope({ clubId, teamId, competitionId })) {
    return { photos: [], files: [], subfolders: [] };
  }

  return withFeatureBackend("vault", {
    supabase: async () => {
      let itemsQuery = client.from("vault_files").select("*").is("deleted_at", null);
      itemsQuery = applyScope(itemsQuery, clubId, teamId, competitionId);
      itemsQuery = folderId
        ? itemsQuery.eq("folder_id", folderId)
        : itemsQuery.is("folder_id", null);
      const { data: rows } = await itemsQuery;

      let subfoldersQuery = client
        .from("vault_folders")
        .select("*")
        .is("deleted_at", null);
      subfoldersQuery = applyScope(subfoldersQuery, clubId, teamId);
      subfoldersQuery = folderId
        ? subfoldersQuery.eq("parent_id", folderId)
        : subfoldersQuery.is("parent_id", null);
      const { data: childFolders } = await subfoldersQuery;

      const all = await resolveCompetitionVaultFileUrls((rows || []) as any[], client);
      return toLiveFolderContents(all, childFolders || [], path);
    },
    icp: async (ctx) => {
      // clubId is the ICP club scope; team-only export scope isn't
      // representable on vault_domain (club is required), so clubId must
      // be present whenever teamId is for an ICP-backed export.
      const {
        listLiveVaultFolders,
        listLiveVaultClubFilesWithFolder,
        listLiveVaultFilesWithFolder,
      } = await import("@/live/features/vault");
      const [liveFolders, liveFiles] = await Promise.all([
        listLiveVaultFolders(ctx, clubId as string, teamId, null, competitionId),
        competitionId
          ? listLiveVaultFilesWithFolder(ctx, folderId ?? "", competitionId)
          : listLiveVaultClubFilesWithFolder(ctx, clubId as string, teamId),
      ]);
      const rows = (liveFiles as any[]).map(unwrapLiveVaultFileWithFolder).map(mapLiveVaultFile);
      const allFolders = (liveFolders as any[]).map(mapLiveVaultFolder);

      const all = rows.filter(r => (folderId ? r.folder_id === folderId : !r.folder_id));
      const childFolders = allFolders.filter(f =>
        folderId ? f.parent_id === folderId : !f.parent_id,
      );

      return toLiveFolderContents(all, childFolders, path);
    },
  }, competitionId ? { competitionId } : clubId ? { clubId } : { teamId: teamId ?? "" });
};

/** Depth-first recursive collection with per-folder breakdown counts. */
export const collectVaultExportContents = async (
  scope: VaultExportScope,
  path: string = "",
  folderBreakdown: { path: string; photoCount: number; fileCount: number }[] = [],
  client: Client = defaultClient,
): Promise<VaultExportContents> => {
  if (!hasVaultExportScope(scope)) {
    return { photos: [], files: [], subfolders: [], folderBreakdown: [] };
  }

  const contents = await fetchVaultFolderContents(scope, path, client);

  folderBreakdown.push({
    path: path || "(current folder)",
    photoCount: contents.photos.length,
    fileCount: contents.files.length,
  });

  let allPhotos = [...contents.photos];
  let allFiles = [...contents.files];

  for (const { folder, path: subPath } of contents.subfolders) {
    const sub = await collectVaultExportContents(
      { ...scope, folderId: folder.id },
      subPath,
      folderBreakdown,
      client,
    );
    allPhotos = [...allPhotos, ...sub.photos];
    allFiles = [...allFiles, ...sub.files];
  }

  return {
    photos: allPhotos,
    files: allFiles,
    subfolders: contents.subfolders,
    folderBreakdown,
  };
};
