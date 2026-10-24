import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveClubStoragePurchasedGb } from "@/live/features/promoCodes";
import { listStoredClubMedia } from "./clubMediaAllowance";

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
  vaultTotal?: number;
  pending?: number;
  otherMedia?: number;
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
  // Defense-in-depth: VaultPage only calls this repository from Supabase-only
  // query paths today, but guard here too so an II principal can never fire
  // this Supabase read if a future caller forgets to route around it.
  // ICP: storage add-ons granted by on-chain storage promo redemptions
  // (club_domain). Paid storage downgrades don't exist on-chain.
  if (resolveAuthBackend() === "icp") {
    const gb = await withFeatureBackend("membership", {
      supabase: async () => 0,
      icp: (ctx) => getLiveClubStoragePurchasedGb(ctx, clubId),
    }, { clubId });
    return { storage_purchased_gb: gb, scheduled_storage_downgrade_gb: null, storage_downgrade_at: null };
  }
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
  // Secure sign-in: total club media straight from the photo store (no
  // Supabase reads). The on-chain Pro allowance covers vault, gallery and
  // chat combined, so the store's own club-bytes reading is authoritative;
  // vault-file accounting is the fallback for stores that predate it.
  if (resolveAuthBackend() === "icp") {
    const { withFeatureBackend } = await import("@/live/featureRouter");
    return withFeatureBackend("vault", {
      supabase: async () => emptyVaultStorageBreakdown(),
      icp: async (ctx) => {
        const [{ listLiveVaultClubFiles }, { listLiveTeams }, { getLiveClubMediaBytes }] = await Promise.all([
          import("@/live/features/vault"),
          import("@/live/features/club"),
          import("@/live/blobStoreUpload"),
        ]);
        const [files, teams, storeBytes] = await Promise.all([
          listLiveVaultClubFiles(ctx, clubId, null, null),
          listLiveTeams(ctx, clubId).catch(() => [] as any[]),
          getLiveClubMediaBytes(ctx.target, ctx.identity, clubId),
        ]);
        const breakdown = calculateVaultStorageBreakdown({
          photos: [],
          files: (files as any[])
            .filter((file) => !file.is_external_link)
            .map((file) => ({
              file_size: Number(file.size ?? 0),
              team_id: file.team?.[0] ?? null,
              mini_league_id: file.mini_league_id?.[0] ?? null,
              name: file.name ?? null,
            })),
          teams: (teams as any[]).map((team) => ({ id: team.id, name: team.name })),
          miniLeagues: [],
        });
        const storeTotal = storeBytes.finalized + storeBytes.pending;
        return { ...breakdown, total: storeTotal, vaultTotal: breakdown.total, pending: storeBytes.pending, otherMedia: Math.max(0, storeBytes.finalized - breakdown.total) };
      },
    }, { clubId });
  }
  const { error: photosError } = await client
    .from("photos")
    .select("file_size, team_id, mini_league_id")
    .eq("club_id", clubId)
    .is("deleted_at", null);
  const { error: filesError } = await client
    .from("vault_files")
    .select("*")
    .eq("club_id", clubId)
    .is("deleted_at", null);
  const { data: teams, error: teamsError } = await client
    .from("teams")
    .select("id, name")
    .eq("club_id", clubId)
    .is("deleted_at", null);
  const { data: miniLeagues, error: leaguesError } = await client
    .from("mini_leagues")
    .select("id, name")
    .eq("club_id", clubId);

  if (photosError || filesError || teamsError || leaguesError) throw photosError || filesError || teamsError || leaguesError;
  const objects = await listStoredClubMedia(clubId, client);
  const physicalPhotos = objects.filter((object) => isVaultStorageImageFilename(object.path));
  const physicalFiles = objects.filter((object) => !isVaultStorageImageFilename(object.path));
  const breakdown = calculateVaultStorageBreakdown({
    photos: [],
    files: objects.map(object => {
      const parts = object.path.split("/");
      return {
        file_size: object.size,
        name: object.path,
        team_id: parts[2] === "teams" ? parts[3] ?? null : null,
        mini_league_id: parts[2] === "mini-leagues" ? parts[3] ?? null : null,
      };
    }),
    teams: teams ?? [],
    miniLeagues: miniLeagues ?? [],
  });
  return {
    ...breakdown,
    photos: physicalPhotos.reduce((sum, object) => sum + object.size, 0),
    documents: physicalFiles.reduce((sum, object) => sum + object.size, 0),
    total: objects.reduce((sum, object) => sum + object.size, 0),
  };
}
