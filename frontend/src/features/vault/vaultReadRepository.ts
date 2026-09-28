import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { VaultFolderView } from "./types";
import { filterVisibleVaultFolders, getVaultScope } from "./vaultScope";
import { isVaultImageItem } from "./vaultItemClassification";

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
  let query = client.from("vault_folders").select("*").is("deleted_at", null);

  if (view.type === "club") {
    query = query.eq("club_id", view.clubId).is("team_id", null);
  } else {
    query = query.eq("team_id", view.teamId);
  }

  query = scope.folderId
    ? query.eq("parent_id", scope.folderId)
    : query.is("parent_id", null);

  const { data } = await query.order("name");
  return filterVisibleVaultFolders(data ?? [], {
    isPrivilegedViewer: options.isAppAdmin || options.isClubAdmin,
    restrictClubRootToChatFolders:
      view.type === "club" && !options.isClubAdmin && options.isCoachOrTeamAdmin,
    clubRoles: options.clubRoles,
  });
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
  } else {
    query = query.eq("mini_league_id", view.miniLeagueId);
  }

  query = scope.folderId
    ? query.eq("folder_id", scope.folderId)
    : query.is("folder_id", null);
  const { data } = await query.order("created_at", { ascending: false });
  return data ?? [];
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
  if (options.view.type !== "club" && options.view.type !== "team") return empty();

  const scope = getVaultScope(options.view);
  let query = client
    .from("vault_folders")
    .select("id,name,parent_id,restricted_roles");
  query = options.view.type === "club"
    ? query.eq("club_id", options.view.clubId).is("team_id", null)
    : query.eq("team_id", options.view.teamId);
  const { data } = await query;
  return buildVaultFolderTree(data ?? [], scope.folderId, options);
}

export async function searchVaultContents(
  options: {
    view: VaultFolderView;
    searchQuery: string;
    tree: VaultFolderTree;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<{ folders: VaultSearchFolder[]; files: VaultSearchFile[] }> {
  if (options.view.type === "root") return { folders: [], files: [] };

  const normalized = options.searchQuery.trim();
  const escaped = normalized.replace(/[\\%_]/g, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  const scope = getVaultScope(options.view);

  let query = client
    .from("vault_files")
    .select("id,folder_id,club_id,team_id,mini_league_id,name,file_url,file_size,file_type,uploaded_by,created_at,is_external_link")
    .is("deleted_at", null)
    .ilike("name", pattern)
    .limit(200);

  if (options.view.type === "club") {
    query = query
      .eq("club_id", options.view.clubId)
      .is("team_id", null)
      .is("mini_league_id", null);
  } else if (options.view.type === "team") {
    query = query.eq("team_id", options.view.teamId);
  } else {
    query = query.eq("mini_league_id", options.view.miniLeagueId);
  }

  if (scope.folderId) {
    query = query.in("folder_id", [scope.folderId, ...options.tree.descendantIds]);
  }

  const lowerQuery = normalized.toLowerCase();
  const folders = options.tree.descendants
    .filter((folder) => folder.name.toLowerCase().includes(lowerQuery))
    .map((folder) => ({
      ...folder,
      folder_path: options.tree.pathById.get(folder.id) || folder.name,
    }));

  const { data } = await query.order("created_at", { ascending: false });
  const visibleFolderIds = new Set(options.tree.descendantIds);
  const files = (data ?? [])
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

  return { folders, files };
}

export async function fetchVaultTrash(
  view: VaultFolderView,
  client: IgniteSupabaseClient = supabase,
): Promise<{ photos: VaultPhotoItem[]; files: VaultFileRow[] }> {
  if (view.type === "root") return { photos: [], files: [] };

  const { data } = await client
    .from("vault_files")
    .select(`
      *,
      folder:vault_folders(id, name),
      team:teams(id, name)
    `)
    .eq("club_id", view.clubId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  return partitionVaultItems(data as unknown as VaultFileRow[] | null);
}
