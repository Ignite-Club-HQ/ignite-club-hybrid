import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { mapLiveVaultFolder } from "./vaultReadRepository";

export async function fetchVaultMoveFolders(clubId: string | null, teamId: string | null) {
  if (!clubId && !teamId) return [];
  return withFeatureBackend("vault", {
    supabase: async () => {
      let query = supabase.from("vault_folders").select("id,name,parent_id,team_id")
        .is("deleted_at", null).order("name");
      query = teamId ? query.eq("team_id", teamId) : query.eq("club_id", clubId ?? "");
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    icp: async ctx => {
      const { listLiveVaultFolders } = await import("@/live/features/vault");
      const { getLiveTeam } = await import("@/live/features/club");
      const owner = clubId ?? (teamId ? (await getLiveTeam(ctx, teamId))[0]?.club_id : null);
      if (!owner) throw new Error("Vault club could not be resolved");
      return (await listLiveVaultFolders(ctx, owner, teamId)).map(mapLiveVaultFolder)
        .filter(folder => !folder.deleted_at && (!teamId || folder.team_id === teamId))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  }, teamId ? { teamId } : { clubId: clubId ?? "" });
}