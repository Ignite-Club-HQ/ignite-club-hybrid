import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  permanentlyDeleteVaultItems,
  type VaultDeleteFailure,
  type VaultDeleteSuccess,
} from "@/lib/vaultDelete";
import { softDeleteVaultItem } from "./vaultMutationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;

export interface VaultSelectionDeleteResult {
  deletedPhotoIds: string[];
  deletedFileIds: string[];
  failed: Array<{ id: string; kind: "photo" | "file"; error: unknown }>;
}

export async function softDeleteVaultSelection(
  options: {
    photoIds: string[];
    fileIds: string[];
    deletedBy: string | undefined;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultSelectionDeleteResult> {
  const result: VaultSelectionDeleteResult = {
    deletedPhotoIds: [],
    deletedFileIds: [],
    failed: [],
  };

  for (const id of options.photoIds) {
    try {
      await softDeleteVaultItem(id, options.deletedBy, new Date(), client);
      result.deletedPhotoIds.push(id);
    } catch (error) {
      result.failed.push({ id, kind: "photo", error });
    }
  }

  for (const id of options.fileIds) {
    try {
      await softDeleteVaultItem(id, options.deletedBy, new Date(), client);
      result.deletedFileIds.push(id);
    } catch (error) {
      result.failed.push({ id, kind: "file", error });
    }
  }

  return result;
}

export interface VaultTrashDeleteResult {
  photosDeleted: number;
  filesDeleted: number;
  requested: VaultDeleteSuccess[];
  succeeded: VaultDeleteSuccess[];
  failed: VaultDeleteFailure[];
}

export async function permanentlyDeleteVaultTrash(
  options: {
    photos: Array<{ id: string; file_url?: string | null }>;
    files: Array<{ id: string }>;
  },
  client: IgniteSupabaseClient = supabase,
  deleteItems: typeof permanentlyDeleteVaultItems = permanentlyDeleteVaultItems,
): Promise<VaultTrashDeleteResult> {
  const photoTableIds: string[] = [];
  for (const photo of options.photos) {
    if (!photo.file_url) continue;
    const { data: photoRecord } = await client
      .from("photos")
      .select("id")
      .eq("image_url", photo.file_url)
      .maybeSingle();
    if (photoRecord) photoTableIds.push(photoRecord.id);
  }

  const fileIds = [
    ...options.photos.map((photo) => photo.id),
    ...options.files.map((file) => file.id),
  ];
  const result = await deleteItems({
    photoIds: photoTableIds,
    fileIds,
  });
  return {
    ...result,
    requested: [
      ...photoTableIds.map((id) => ({ id, kind: "photo" as const })),
      ...fileIds.map((id) => ({ id, kind: "file" as const })),
    ],
  };
}
