import { vaultViewScope } from "@/live/featureScopes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { VaultFolderView } from "./types";
import { filterVisibleVaultFolders, getVaultScope } from "./vaultScope";
import { isVaultImageItem } from "./vaultItemClassification";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  listLiveVaultClubFiles,
  listLiveVaultClubFilesWithFolder,
  listLiveVaultFiles,
  listLiveVaultFilesWithFolder,
  listLiveVaultFolders,
  listLiveVaultTrashWithFolder,
} from "@/live/features/vault";

/**
 * Map vault_domain canister records onto the Supabase vault row shapes the
 * UI consumes. Provisional: the canister has no mini-league scope, and the
 * uploader is an ICP principal (rendered as its text form) rather than a
 * Supabase user id — verify against the deployed canister.
 */
export function mapLiveVaultFolder(folder: any): VaultFolderRow {
  return {
    id: folder.id,
    name: folder.name,
    club_id: folder.club,
    team_id: folder.team[0] ?? null,
    mini_league_id: folder.mini_league_id?.[0] ?? null,
    competition_id: folder.competition_id?.[0] ?? null,
    parent_id: folder.parent_id[0] ?? null,
    restricted_roles: folder.restricted_roles ?? [],
    created_at: new Date(Number(folder.created_at_ms)).toISOString(),
    deleted_at:
      folder.deleted_at_ms[0] !== undefined
        ? new Date(Number(folder.deleted_at_ms[0])).toISOString()
        : null,
  } as unknown as VaultFolderRow;
}

/**
 * Unwraps a VaultFileWithFolder envelope down to the plain file record while
 * carrying folder_name/folder_path along as extra properties, so callers get
 * folder context without a separate folder-id join.
 */
export function unwrapLiveVaultFileWithFolder(entry: any): any {
  if (entry && typeof entry === "object" && "file" in entry) {
    return {
      ...entry.file,
      _folder_name: entry.folder_name?.[0] ?? entry.folder_name ?? null,
      _folder_path: Array.isArray(entry.folder_path) ? entry.folder_path : [],
    };
  }
  return entry;
}

export function mapLiveVaultFile(file: any): VaultFileRow {
  return {
    id: file.id,
    folder_id: Array.isArray(file.folder_id) ? file.folder_id[0] ?? null : file.folder_id ?? null,
    club_id: file.club,
    team_id: file.team[0] ?? null,
    mini_league_id: file.mini_league_id?.[0] ?? null,
    competition_id: file.competition_id?.[0] ?? null,
    name: file.name,
    file_url: file.file_url,
    file_size: Number(file.size),
    file_type: file.mime,
    uploaded_by: file.uploaded_by?.toText?.() ?? String(file.uploaded_by),
    created_at: new Date(Number(file.created_at_ms)).toISOString(),
    deleted_at:
      file.deleted_at_ms[0] !== undefined
        ? new Date(Number(file.deleted_at_ms[0])).toISOString()
        : null,
    deleted_by: file.deleted_by?.[0]
      ? (file.deleted_by[0]?.toText?.() ?? String(file.deleted_by[0]))
      : null,
    is_external_link: file.is_external_link,
    ...(file._folder_name !== undefined ? { _folder_name: file._folder_name } : {}),
    ...(file._folder_path !== undefined ? { _folder_path: file._folder_path } : {}),
  } as unknown as VaultFileRow;
}

type IgniteSupabaseClient = SupabaseClient<Database>;
export type VaultFolderRow = Database["public"]["Tables"]["vault_folders"]["Row"];
export type VaultFileRow = Database["public"]["Tables"]["vault_files"]["Row"];
export type VaultFolderTreeRow = Pick<
  VaultFolderRow,
  "id" | "name" | "parent_id" | "restricted_roles"
>;
export type VaultFolderTree = {
  descendants: VaultFolderTreeRow[];
  pathById: Map<string, string>;
  descendantIds: string[];
};
export type VaultSearchFolder = VaultFolderTreeRow & { folder_path: string };
export async function resolveCompetitionVaultFileUrls<T extends {
  file_url: string;
  storage_bucket?: string | null;
  storage_path?: string | null;
}>(rows: readonly T[], client: IgniteSupabaseClient = supabase): Promise<T[]> {
  return Promise.all(rows.map(async (row) => {
    if (row.storage_bucket !== "competition-vault" || !row.storage_path) return row;
    const { data, error } = await client.storage
      .from("competition-vault")
      .createSignedUrl(row.storage_path, 3600);
    if (error || !data?.signedUrl) throw error ?? new Error("Could not sign competition Vault file");
    return { ...row, file_url: data.signedUrl };
  }));
}

export type VaultSearchFile = Pick<
  VaultFileRow,
  | "id"
  | "folder_id"
  | "club_id"
  | "team_id"
  | "mini_league_id"
  | "name"
  | "file_url"
  | "file_size"
  | "file_type"
  | "uploaded_by"
  | "created_at"
  | "is_external_link"
> & {
  image_url: VaultFileRow["file_url"];
  uploader_id: VaultFileRow["uploaded_by"];
  title: VaultFileRow["name"];
  folder_path: string;
};
export type VaultPhotoItem = VaultFileRow & {
  image_url: VaultFileRow["file_url"];
  uploader_id: VaultFileRow["uploaded_by"];
  title: VaultFileRow["name"];
};

export function isVaultImage(item: Pick<VaultFileRow, "file_type" | "name" | "file_url">): boolean {
  return isVaultImageItem(item);
}

export function partitionVaultItems(items: readonly VaultFileRow[] | null | undefined): {
  photos: VaultPhotoItem[];
  files: VaultFileRow[];
} {
  const photos: VaultPhotoItem[] = [];
  const files: VaultFileRow[] = [];
  for (const item of items ?? []) {
    if (isVaultImage(item)) {
      photos.push({
        ...item,
        image_url: item.file_url,
        uploader_id: item.uploaded_by,
        title: item.name,
      });
    } else {
      files.push(item);
    }
  }
  return { photos, files };
}

export function buildVaultFolderTree(
  folders: readonly VaultFolderTreeRow[],
  startFolderId: string | null,
  options: {
    isPrivilegedViewer: boolean;
    clubRoles: ReadonlySet<string>;
  },
): VaultFolderTree {
  const visible = folders.filter((folder) => {
    if (!folder.restricted_roles?.length) return true;
    if (options.isPrivilegedViewer) return true;
    return folder.restricted_roles.some((role) => options.clubRoles.has(role));
  });

  const childMap = new Map<string | null, VaultFolderTreeRow[]>();
  for (const folder of visible) {
    const siblings = childMap.get(folder.parent_id) ?? [];
    siblings.push(folder);
    childMap.set(folder.parent_id, siblings);
  }

  const descendants: VaultFolderTreeRow[] = [];
  const pathById = new Map<string, string>();
  const stack: Array<{ id: string | null; path: string }> = [
    { id: startFolderId, path: "" },
  ];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    for (const child of childMap.get(current.id) ?? []) {
      const path = current.path ? `${current.path} / ${child.name}` : child.name;
      descendants.push(child);
      pathById.set(child.id, path);
      stack.push({ id: child.id, path });
    }
  }

  return { descendants, pathById, descendantIds: descendants.map((folder) => folder.id) };
}

export async function fetchVaultSubfolders(
  options: {
    view: VaultFolderView;
    isAppAdmin: boolean;
    isClubAdmin: boolean;
    isCoachOrTeamAdmin: boolean;
    clubRoles: ReadonlySet<string>;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultFolderRow[]> {
  const { view } = options;
  if (view.type === "root" || view.type === "mini-league") return [];
  if (
    view.type === "club" &&
    !options.isClubAdmin &&
    !options.isCoachOrTeamAdmin &&
    options.clubRoles.size === 0
  ) {
    return [];
  }

  const scope = getVaultScope(view);
  const visibility = {
    isPrivilegedViewer: options.isAppAdmin || options.isClubAdmin,
    restrictClubRootToChatFolders:
      view.type === "club" && !options.isClubAdmin && options.isCoachOrTeamAdmin,
    clubRoles: options.clubRoles,
  };

  return withFeatureBackend("vault", {
    supabase: async () => {
      let query = client.from("vault_folders").select("*").is("deleted_at", null);

      if (view.type === "club") {
        query = query.eq("club_id", view.clubId).is("team_id", null);
      } else if (view.type === "competition") {
        query = query.eq("club_id", view.clubId).eq("competition_id", view.competitionId);
      } else {
        query = query.eq("team_id", view.teamId);
      }

      query = scope.folderId
        ? query.eq("parent_id", scope.folderId)
        : query.is("parent_id", null);

      const { data } = await query.order("name");
      return filterVisibleVaultFolders(data ?? [], visibility);
    },
    // Provisional: mini-league scoping has no canister shape (handled by the
    // early return above); verify folder semantics against vault_domain.
    icp: async (ctx) => {
      const folders = await listLiveVaultFolders(
        ctx,
        view.clubId,
        view.type === "team" ? view.teamId : null,
        null,
        view.type === "competition" ? view.competitionId : null,
      );
      const children = (folders as any[])
        .map(mapLiveVaultFolder)
        .filter((folder) =>
          scope.folderId ? folder.parent_id === scope.folderId : folder.parent_id === null,
        );
      return filterVisibleVaultFolders(children, visibility);
    },
  }, vaultViewScope(view));
}

export async function fetchVaultItems(
  options: {
    view: VaultFolderView;
    isClubAdmin: boolean;
    isCoachOrTeamAdmin: boolean;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultFileRow[]> {
  const { view } = options;
  if (view.type === "root") return [];
  const scope = getVaultScope(view);

  return withFeatureBackend("vault", {
    supabase: async () => {
      let query = client.from("vault_files").select("*").is("deleted_at", null);

      if (view.type === "club") {
        if (!options.isClubAdmin && !options.isCoachOrTeamAdmin) return [];
        query = query
          .eq("club_id", view.clubId)
          .is("team_id", null)
          .is("mini_league_id", null);
        if (!options.isClubAdmin && options.isCoachOrTeamAdmin && !scope.folderId) return [];
      } else if (view.type === "team") {
        query = query.eq("team_id", view.teamId);
      } else if (view.type === "competition") {
        query = query.eq("club_id", view.clubId).eq("competition_id", view.competitionId);
      } else {
        query = query.eq("mini_league_id", view.miniLeagueId);
      }

      query = scope.folderId
        ? query.eq("folder_id", scope.folderId)
        : query.is("folder_id", null);
      const { data } = await query.order("created_at", { ascending: false });
      return resolveCompetitionVaultFileUrls((data ?? []) as VaultFileRow[], client);
    },
    // Provisional: mini-league views resolve through the canister's
    // mini_league_id scope; verify against the deployed canister post-deploy.
    icp: async (ctx) => {
      if (view.type === "club") {
        if (!options.isClubAdmin && !options.isCoachOrTeamAdmin) return [];
        if (!options.isClubAdmin && options.isCoachOrTeamAdmin && !scope.folderId) return [];
      }
      const files = scope.folderId
        ? await listLiveVaultFilesWithFolder(
            ctx,
            scope.folderId,
            view.type === "competition" ? view.competitionId : null,
          )
        : await listLiveVaultClubFilesWithFolder(
            ctx,
            view.clubId,
            view.type === "team" ? view.teamId : null,
            view.type === "mini-league" ? view.miniLeagueId : null,
            view.type === "competition" ? view.competitionId : null,
          );
      const rows = (files as any[]).map(unwrapLiveVaultFileWithFolder).map(mapLiveVaultFile);
      return scope.folderId ? rows : rows.filter((row) => !row.folder_id);
    },
  }, vaultViewScope(view));
}

export async function fetchVaultFolderTree(
  options: {
    view: VaultFolderView;
    isPrivilegedViewer: boolean;
    clubRoles: ReadonlySet<string>;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultFolderTree> {
  const empty = (): VaultFolderTree => ({
    descendants: [],
    pathById: new Map(),
    descendantIds: [],
  });
  if (options.view.type !== "club" && options.view.type !== "team" && options.view.type !== "competition") return empty();

  const scope = getVaultScope(options.view);
  const view = options.view;
  return withFeatureBackend("vault", {
    supabase: async () => {
      let query = client
        .from("vault_folders")
        .select("id,name,parent_id,restricted_roles");
      if (options.view.type === "club") {
        query = query.eq("club_id", options.view.clubId).is("team_id", null);
      } else if (options.view.type === "team") {
        query = query.eq("team_id", options.view.teamId);
      } else if (options.view.type === "competition") {
        query = query.eq("club_id", options.view.clubId).eq("competition_id", options.view.competitionId);
      }
      const { data } = await query;
      return buildVaultFolderTree(data ?? [], scope.folderId, options);
    },
    icp: async (ctx) => {
      // Fail closed: club-level folder trees need a privileged or club role.
      if (view.type === "club" && !options.isPrivilegedViewer && options.clubRoles.size === 0) {
        return empty();
      }
      const folders = await listLiveVaultFolders(
        ctx,
        view.clubId,
        view.type === "team" ? view.teamId : null,
        null,
        view.type === "competition" ? view.competitionId : null,
      );
      const rows = (folders as any[]).map(mapLiveVaultFolder).filter((folder) => {
        if (folder.deleted_at) return false;
        if (view.type === "club") return !folder.team_id;
        if (view.type === "team") return folder.team_id === view.teamId;
        return (folder as any).competition_id === view.competitionId;
      });
      return buildVaultFolderTree(rows, scope.folderId, options);
    },
  }, vaultViewScope(view));
}

export async function searchVaultContents(
  options: {
    view: VaultFolderView;
    searchQuery: string;
    tree: VaultFolderTree;
    isClubAdmin?: boolean;
    isCoachOrTeamAdmin?: boolean;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<{ folders: VaultSearchFolder[]; files: VaultSearchFile[] }> {
  if (options.view.type === "root") return { folders: [], files: [] };

  const normalized = options.searchQuery.trim();
  const escaped = normalized.replace(/[\\%_]/g, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  const scope = getVaultScope(options.view);
  const view = options.view;
  const lowerQuery = normalized.toLowerCase();

  const shape = (resolvedData: VaultFileRow[]) => {
    const folders = options.tree.descendants
      .filter((folder) => folder.name.toLowerCase().includes(lowerQuery))
      .map((folder) => ({
        ...folder,
        folder_path: options.tree.pathById.get(folder.id) || folder.name,
      }));
    const visibleFolderIds = new Set(options.tree.descendantIds);
    const files = resolvedData
      .filter(
        (file) =>
          !file.folder_id ||
          visibleFolderIds.has(file.folder_id) ||
          file.folder_id === scope.folderId,
      )
      .map((file) => ({
        ...file,
        image_url: file.file_url,
        uploader_id: file.uploaded_by,
        title: file.name,
        folder_path: file.folder_id
          ? options.tree.pathById.get(file.folder_id) || ""
          : "",
      }));
    return { folders, files } as { folders: VaultSearchFolder[]; files: VaultSearchFile[] };
  };

  return withFeatureBackend("vault", {
    supabase: async () => {
      let query = client
        .from("vault_files")
        .select("id,folder_id,club_id,team_id,mini_league_id,name,file_url,file_size,file_type,uploaded_by,created_at,is_external_link")
        .is("deleted_at", null)
        .ilike("name", pattern)
        .limit(200);

      if (view.type === "club") {
        query = query
          .eq("club_id", view.clubId)
          .is("team_id", null)
          .is("mini_league_id", null);
      } else if (view.type === "team") {
        query = query.eq("team_id", view.teamId);
      } else if (view.type === "competition") {
        query = query.eq("club_id", view.clubId).eq("competition_id", view.competitionId);
      } else {
        query = query.eq("mini_league_id", view.miniLeagueId);
      }

      if (scope.folderId) {
        query = query.in("folder_id", [scope.folderId, ...options.tree.descendantIds]);
      }

      const { data } = await query.order("created_at", { ascending: false });
      const resolvedData = await resolveCompetitionVaultFileUrls(
        (data ?? []) as VaultFileRow[],
        client,
      );
      return shape(resolvedData);
    },
    icp: async (ctx) => {
      // Fail closed: club-level files need an admin or coach role.
      if (view.type === "club" && !options.isClubAdmin && !options.isCoachOrTeamAdmin) {
        return { folders: [], files: [] };
      }
      const entries = await listLiveVaultClubFilesWithFolder(
        ctx,
        view.clubId,
        view.type === "team" ? view.teamId : null,
        view.type === "mini-league" ? view.miniLeagueId : null,
        view.type === "competition" ? view.competitionId : null,
      );
      const rows = (entries as any[])
        .map(unwrapLiveVaultFileWithFolder)
        .map(mapLiveVaultFile)
        .filter((file) => {
          if (file.deleted_at) return false;
          if (!file.name.toLowerCase().includes(lowerQuery)) return false;
          if (scope.folderId && file.folder_id !== scope.folderId && !options.tree.descendantIds.includes(file.folder_id ?? "")) return false;
          if (view.type === "club") return !file.team_id && !file.mini_league_id;
          if (view.type === "team") return file.team_id === view.teamId;
          if (view.type === "competition") return (file as any).competition_id === view.competitionId;
          return file.mini_league_id === view.miniLeagueId;
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 200);
      return shape(rows);
    },
  }, vaultViewScope(view));
}

/**
 * Folder/file lookups for the chat vault picker (VaultPickerSheet): a
 * simpler surface than fetchVaultSubfolders/fetchVaultItems — no role-based
 * folder restriction, just "this club/team, this parent" — mirrored against
 * the canister the same way as the rest of this module.
 */
export type VaultPickerFolder = Pick<
  VaultFolderRow,
  "id" | "name" | "parent_id" | "team_id" | "club_id"
>;
export type VaultPickerFile = Pick<
  VaultFileRow,
  "id" | "name" | "file_type" | "file_size" | "folder_id" | "team_id" | "club_id" | "is_external_link"
>;

export async function listVaultPickerFolders(
  options: { clubId: string; teamId: string | null; parentId: string | null },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultPickerFolder[]> {
  const { clubId, teamId, parentId } = options;

  return withFeatureBackend("vault", {
    supabase: async () => {
      let query = client
        .from("vault_folders")
        .select("id, name, parent_id, team_id, club_id")
        .eq("club_id", clubId)
        .order("name");

      if (parentId) {
        query = query.eq("parent_id", parentId);
      } else {
        query = query.is("parent_id", null);
        query = teamId ? query.or(`team_id.is.null,team_id.eq.${teamId}`) : query.is("team_id", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as VaultPickerFolder[];
    },
    // Provisional: the canister has no mini-league scope for the picker's
    // purposes; verify against the deployed canister.
    icp: async (ctx) => {
      const folders = (await listLiveVaultFolders(ctx, clubId, null)) as any[];
      const mapped = folders.map(mapLiveVaultFolder) as VaultPickerFolder[];
      return mapped.filter((folder) => {
        if (parentId) return folder.parent_id === parentId;
        if (folder.parent_id !== null) return false;
        return teamId ? folder.team_id === null || folder.team_id === teamId : folder.team_id === null;
      });
    },
  }, { clubId });
}

export async function listVaultPickerFiles(
  options: { clubId: string; teamId: string | null; folderId: string | null },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultPickerFile[]> {
  const { clubId, teamId, folderId } = options;

  return withFeatureBackend("vault", {
    supabase: async () => {
      let query = client
        .from("vault_files")
        .select("id, name, file_type, file_size, folder_id, team_id, club_id, is_external_link")
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("name");

      if (folderId) {
        query = query.eq("folder_id", folderId);
      } else {
        query = query.is("folder_id", null);
        query = teamId ? query.or(`team_id.is.null,team_id.eq.${teamId}`) : query.is("team_id", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as VaultPickerFile[];
    },
    icp: async (ctx) => {
      const rawFiles = folderId
        ? await listLiveVaultFiles(ctx, folderId)
        : await listLiveVaultClubFiles(ctx, clubId, null);
      const mapped = (rawFiles as any[])
        .map(mapLiveVaultFile)
        .filter((file) => !file.deleted_at) as VaultPickerFile[];

      if (folderId) return mapped;
      return mapped.filter((file) => {
        if (file.folder_id) return false;
        return teamId ? file.team_id === null || file.team_id === teamId : file.team_id === null;
      });
    },
  }, { clubId });
}

/**
 * Child folder/file counts for a batch of folders, used by the vault picker
 * to show "X folders · Y files" next to each row without a per-folder query.
 */
export async function listVaultPickerFolderChildCounts(
  options: { clubId: string; teamId: string | null; folderIds: string[] },
  client: IgniteSupabaseClient = supabase,
): Promise<Map<string, { folders: number; files: number }>> {
  const { clubId, folderIds } = options;
  const counts = new Map<string, { folders: number; files: number }>();
  if (folderIds.length === 0) return counts;
  for (const id of folderIds) counts.set(id, { folders: 0, files: 0 });

  return withFeatureBackend("vault", {
    supabase: async () => {
      const [{ data: subfolders, error: subErr }, { data: subfiles, error: fileErr }] = await Promise.all([
        client.from("vault_folders").select("parent_id").eq("club_id", clubId).in("parent_id", folderIds),
        client
          .from("vault_files")
          .select("folder_id")
          .eq("club_id", clubId)
          .is("deleted_at", null)
          .in("folder_id", folderIds),
      ]);
      if (subErr) throw subErr;
      if (fileErr) throw fileErr;

      for (const row of subfolders || []) {
        const pid = (row as { parent_id: string | null }).parent_id;
        const c = pid ? counts.get(pid) : undefined;
        if (c) c.folders += 1;
      }
      for (const row of subfiles || []) {
        const fid = (row as { folder_id: string | null }).folder_id;
        const c = fid ? counts.get(fid) : undefined;
        if (c) c.files += 1;
      }
      return counts;
    },
    // Provisional: the canister has no bulk "children of these folders"
    // query, so we pull the full club folder/file lists and tally client
    // side — verify this stays cheap once real clubs have deep vault trees.
    icp: async (ctx) => {
      const [folders, files] = await Promise.all([
        listLiveVaultFolders(ctx, clubId, null) as Promise<any[]>,
        listLiveVaultClubFiles(ctx, clubId, null) as Promise<any[]>,
      ]);
      const folderIdSet = new Set(folderIds);
      for (const raw of folders) {
        const folder = mapLiveVaultFolder(raw);
        const pid = folder.parent_id;
        if (pid && folderIdSet.has(pid)) counts.get(pid)!.folders += 1;
      }
      for (const raw of files) {
        const file = mapLiveVaultFile(raw);
        if (file.deleted_at) continue;
        const fid = file.folder_id;
        if (fid && folderIdSet.has(fid)) counts.get(fid)!.files += 1;
      }
      return counts;
    },
  }, { clubId });
}

export async function fetchVaultTrash(
  view: VaultFolderView,
  client: IgniteSupabaseClient = supabase,
): Promise<{ photos: VaultPhotoItem[]; files: VaultFileRow[] }> {
  if (view.type === "root") return { photos: [], files: [] };

  return withFeatureBackend("vault", {
    supabase: async () => {
      let query = client
        .from("vault_files")
        .select(`
          *,
          folder:vault_folders(id, name),
          team:teams(id, name)
        `)
        .eq("club_id", view.clubId)
        .not("deleted_at", "is", null);
      query = view.type === "competition"
        ? query.eq("competition_id", view.competitionId)
        : query.is("competition_id", null);
      const { data } = await query.order("deleted_at", { ascending: false });

      const resolved = await resolveCompetitionVaultFileUrls((data ?? []) as unknown as VaultFileRow[], client);
      return partitionVaultItems(resolved);
    },
    // Provisional: no folder/team name joins on the canister.
    icp: async (ctx) => {
      const trashed = await listLiveVaultTrashWithFolder(ctx, view.clubId);
      return partitionVaultItems(
        (trashed as any[]).map(unwrapLiveVaultFileWithFolder).map(mapLiveVaultFile),
      );
    },
  }, vaultViewScope(view));
}
