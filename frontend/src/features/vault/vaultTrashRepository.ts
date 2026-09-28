import { supabase } from "@/integrations/supabase/client";
import {
  partitionVaultItems,
  type VaultFileRow,
  type VaultPhotoItem,
} from "./vaultReadRepository";

type IgniteSupabaseClient = typeof supabase;

export type VaultTrashFile = VaultFileRow & {
  folder?: { id: string; name: string } | null;
  team?: { id: string; name: string } | null;
};

export type VaultTrashPhoto = VaultPhotoItem & VaultTrashFile;

export type VaultTrashItems = {
  photos: VaultTrashPhoto[];
  files: VaultTrashFile[];
};

export function partitionVaultTrashItems(items: VaultTrashFile[]): VaultTrashItems {
  const partitioned = partitionVaultItems(items);
  return {
    photos: partitioned.photos as VaultTrashPhoto[],
    files: partitioned.files as VaultTrashFile[],
  };
}

export async function fetchVaultTrashItems(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultTrashItems> {
  const { data, error } = await client
    .from("vault_files")
    .select(`
      *,
      folder:vault_folders(id, name),
      team:teams(id, name)
    `)
    .eq("club_id", clubId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) throw error;
  return partitionVaultTrashItems((data ?? []) as VaultTrashFile[]);
}
