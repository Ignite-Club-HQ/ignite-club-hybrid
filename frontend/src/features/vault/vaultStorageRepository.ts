import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

export const DEFAULT_VAULT_PHOTO_SIZE = 500 * 1024;

export type VaultStorageSubscription = {
  storage_purchased_gb: number;
  scheduled_storage_downgrade_gb: number | null;
  storage_downgrade_at: string | null;
};

export type VaultStorageBreakdown = {
  photos: number;
  documents: number;
  total: number;
  byTeam: Array<{
    teamId: string | null;
    teamName: string;
    size: number;
    photosSize: number;
    documentsSize: number;
  }>;
  byMiniLeague: Array<{
    miniLeagueId: string;
    miniLeagueName: string;
    size: number;
    photosSize: number;
    documentsSize: number;
  }>;
};

type StoragePhoto = {
  file_size: number | null;
  team_id: string | null;
  mini_league_id: string | null;
};

type StorageFile = {
  file_size: number | null;
  team_id: string | null;
  mini_league_id: string | null;
  name: string | null;
};

type NamedScope = { id: string; name: string };

export function emptyVaultStorageBreakdown(): VaultStorageBreakdown {
  return { photos: 0, documents: 0, total: 0, byTeam: [], byMiniLeague: [] };
}

export function isVaultStorageImageFilename(filename: string): boolean {
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".heic", ".heif", ".tiff", ".tif"]
    .some((extension) => filename.toLowerCase().endsWith(extension));
}

export function calculateVaultStorageBreakdown(options: {
  photos: readonly StoragePhoto[];
  files: readonly StorageFile[];
  teams: readonly NamedScope[];
  miniLeagues: readonly NamedScope[];
}): VaultStorageBreakdown {
  const imageFiles = options.files.filter((file) => isVaultStorageImageFilename(file.name || ""));
  const documentFiles = options.files.filter((file) => !isVaultStorageImageFilename(file.name || ""));
  const photos = options.photos.reduce(
    (sum, photo) => sum + (photo.file_size || DEFAULT_VAULT_PHOTO_SIZE),
    0,
  ) + imageFiles.reduce((sum, file) => sum + (file.file_size || 0), 0);
  const documents = documentFiles.reduce((sum, file) => sum + (file.file_size || 0), 0);

  const teamTotals = new Map<string | null, { photos: number; documents: number }>();
  const leagueTotals = new Map<string, { photos: number; documents: number }>();
  const add = (
    target: Map<string | null, { photos: number; documents: number }>,
    id: string | null,
    kind: "photos" | "documents",
    size: number,
  ) => {
    const current = target.get(id) ?? { photos: 0, documents: 0 };
    current[kind] += size;
    target.set(id, current);
  };

  for (const photo of options.photos) {
    const size = photo.file_size || DEFAULT_VAULT_PHOTO_SIZE;
    if (photo.mini_league_id) add(leagueTotals, photo.mini_league_id, "photos", size);
    else add(teamTotals, photo.team_id, "photos", size);
  }
  for (const file of imageFiles) {
    if (file.mini_league_id) add(leagueTotals, file.mini_league_id, "photos", file.file_size || 0);
    else add(teamTotals, file.team_id, "photos", file.file_size || 0);
  }
  for (const file of documentFiles) {
    if (file.mini_league_id) add(leagueTotals, file.mini_league_id, "documents", file.file_size || 0);
    else add(teamTotals, file.team_id, "documents", file.file_size || 0);
  }

  const teamNames = new Map(options.teams.map((team) => [team.id, team.name]));
  const leagueNames = new Map(options.miniLeagues.map((league) => [league.id, league.name]));
  const byTeam = [...teamTotals.entries()]
    .map(([teamId, sizes]) => ({
      teamId,
      teamName: teamId ? teamNames.get(teamId) || "Unknown Team" : "Club-level",
      size: sizes.photos + sizes.documents,
      photosSize: sizes.photos,
      documentsSize: sizes.documents,
    }))
    .filter((entry) => entry.size > 0)
    .sort((left, right) => right.size - left.size);
  const byMiniLeague = [...leagueTotals.entries()]
    .map(([miniLeagueId, sizes]) => ({
      miniLeagueId,
      miniLeagueName: leagueNames.get(miniLeagueId) || "Unknown Mini-League",
      size: sizes.photos + sizes.documents,
      photosSize: sizes.photos,
      documentsSize: sizes.documents,
    }))
    .filter((entry) => entry.size > 0)
    .sort((left, right) => right.size - left.size);

  return { photos, documents, total: photos + documents, byTeam, byMiniLeague };
}

export async function fetchVaultStorageSubscription(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultStorageSubscription> {
  const { data } = await client
    .from("club_subscriptions")
    .select("storage_purchased_gb, scheduled_storage_downgrade_gb, storage_downgrade_at")
    .eq("club_id", clubId)
    .maybeSingle();
  return data ?? {
    storage_purchased_gb: 0,
    scheduled_storage_downgrade_gb: null,
    storage_downgrade_at: null,
  };
}

export async function fetchVaultStorageBreakdown(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultStorageBreakdown> {
  const { data: photos } = await client
    .from("photos")
    .select("file_size, team_id, mini_league_id")
    .eq("club_id", clubId)
    .is("deleted_at", null);
  const { data: files } = await client
    .from("vault_files")
    .select("*")
    .eq("club_id", clubId)
    .is("deleted_at", null);
  const { data: teams } = await client
    .from("teams")
    .select("id, name")
    .eq("club_id", clubId)
    .is("deleted_at", null);
  const { data: miniLeagues } = await client
    .from("mini_leagues")
    .select("id, name")
    .eq("club_id", clubId);

  return calculateVaultStorageBreakdown({
    photos: photos ?? [],
    files: files ?? [],
    teams: teams ?? [],
    miniLeagues: miniLeagues ?? [],
  });
}
