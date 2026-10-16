import { supabase } from "@/integrations/supabase/client";
import {

// icp-guard: allow called only from useVaultTrashWorkflow's withFeatureBackend supabase branch
  partitionVaultItems,
  type VaultFileRow,
  type VaultPhotoItem,
  resolveCompetitionVaultFileUrls,
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
  competitionId: string | null = null,
): Promise<VaultTrashItems> {
  let query = client
    .from("vault_files")
    .select(`
      *,
      folder:vault_folders(id, name),
      team:teams(id, name)
    `)
    .eq("club_id", clubId)
    .not("deleted_at", "is", null);
  query = competitionId
    ? query.eq("competition_id", competitionId)
    : query.is("competition_id", null);
  const { data, error } = await query.order("deleted_at", { ascending: false });

  if (error) throw error;
  const resolved = await resolveCompetitionVaultFileUrls((data ?? []) as VaultTrashFile[], client);
  return partitionVaultTrashItems(resolved as VaultTrashFile[]);
}
