import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  buildVaultStorageUrl,
  compensateVaultUpload,
  reserveVaultStorage,
  settleVaultStorage,
} from "@/lib/vaultUpload";
import type { VaultFolderView } from "./types";

type IgniteSupabaseClient = SupabaseClient<Database>;
type VaultFileInsert = Database["public"]["Tables"]["vault_files"]["Insert"];

export function getVaultUploadScope(view: VaultFolderView): Pick<
  VaultFileInsert,
  "club_id" | "team_id" | "mini_league_id"
> {
  if (view.type === "club") return { club_id: view.clubId };
  if (view.type === "team") return { club_id: view.clubId, team_id: view.teamId };
  if (view.type === "mini-league") {
    return { club_id: view.clubId, mini_league_id: view.miniLeagueId };
  }
  return {};
}

export function buildVaultUploadPath(options: {
  view: VaultFolderView;
  userId: string;
  fileName: string;
  timestamp?: number;
  randomValue?: number;
}): string {
  const fileExt = options.fileName.split(".").pop();
  const timestamp = options.timestamp ?? Date.now();
  const randomSuffix = (options.randomValue ?? Math.random()).toString(36).substring(7);
  const leaf = `${options.userId}/${timestamp}-${randomSuffix}.${fileExt}`;

  if (options.view.type === "team") {
    return `clubs/${options.view.clubId}/teams/${options.view.teamId}/${leaf}`;
  }
  if (options.view.type === "club") {
    return `clubs/${options.view.clubId}/${leaf}`;
  }
  if (options.view.type === "mini-league") {
    return `clubs/${options.view.clubId}/mini-leagues/${options.view.miniLeagueId}/${leaf}`;
  }
  return `unassigned/${leaf}`;
}

export async function createVaultExternalLink(
  options: {
    url: string;
    name: string;
    userId: string;
    folderId: string | null;
    view: VaultFolderView;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  const insert: VaultFileInsert = {
    file_url: options.url,
    uploaded_by: options.userId,
    name: options.name,
    folder_id: options.folderId,
    is_external_link: true,
    file_size: 0,
    ...getVaultUploadScope(options.view),
  };
  const { error } = await client.from("vault_files").insert(insert);
  if (error) throw error;
}

export interface VaultUploadDependencies {
  reserveStorage: typeof reserveVaultStorage;
  settleStorage: typeof settleVaultStorage;
  compensateUpload: typeof compensateVaultUpload;
  buildStorageUrl: typeof buildVaultStorageUrl;
}

const defaultUploadDependencies: VaultUploadDependencies = {
  reserveStorage: reserveVaultStorage,
  settleStorage: settleVaultStorage,
  compensateUpload: compensateVaultUpload,
  buildStorageUrl: buildVaultStorageUrl,
};

export async function uploadVaultItem(
  options: {
    kind: "photo" | "file";
    file: File;
    name: string;
    userId: string;
    folderId: string | null;
    view: VaultFolderView;
  },
  client: IgniteSupabaseClient = supabase,
  dependencies: VaultUploadDependencies = defaultUploadDependencies,
): Promise<void> {
  const storagePath = buildVaultUploadPath({
    view: options.view,
    userId: options.userId,
    fileName: options.file.name,
  });
  const clubId = "clubId" in options.view ? options.view.clubId ?? null : null;
  const reservationId = await dependencies.reserveStorage(clubId, options.file.size);

  const { error: uploadError } = await client.storage
    .from("photos")
    .upload(storagePath, options.file, { cacheControl: "31536000" });
  if (uploadError) {
    await dependencies.settleStorage(reservationId, false);
    throw uploadError;
  }

  const insert: VaultFileInsert = {
    file_url: dependencies.buildStorageUrl(storagePath),
    storage_bucket: "photos",
    storage_path: storagePath,
    uploaded_by: options.userId,
    name: options.name,
    folder_id: options.folderId,
    file_size: options.file.size,
    ...getVaultUploadScope(options.view),
  };
  if (options.kind === "photo") insert.file_type = options.file.type;

  const { error: insertError } = await client.from("vault_files").insert(insert);
  if (insertError) {
    // Compensate: never leave an orphaned object billed against the club.
    await dependencies.compensateUpload(storagePath);
    await dependencies.settleStorage(reservationId, false);
    throw insertError;
  }

  await dependencies.settleStorage(reservationId, true);
}
