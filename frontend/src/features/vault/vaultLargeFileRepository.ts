import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { buildVaultLargeFileItems, type VaultLargeFileItem } from "./vaultLargeFileManagement";

type IgniteSupabaseClient = SupabaseClient<Database>;

export async function fetchVaultLargeFiles(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultLargeFileItem[]> {
  const { data: teams } = await client
    .from("teams")
    .select("id, name")
    .eq("club_id", clubId)
    .is("deleted_at", null);

  const { data: photos } = await client
    .from("photos")
    .select("id, file_url, file_size, team_id, title, created_at")
    .eq("club_id", clubId)
    .not("file_size", "is", null)
    .order("file_size", { ascending: false })
    .limit(50);

  const { data: files } = await client
    .from("vault_files")
    .select("id, file_url, file_size, team_id, name, created_at")
    .eq("club_id", clubId)
    .not("file_size", "is", null)
    .order("file_size", { ascending: false })
    .limit(50);

  return buildVaultLargeFileItems(teams ?? [], photos ?? [], files ?? []);
}
