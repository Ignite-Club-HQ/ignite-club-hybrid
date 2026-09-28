export interface VaultStoragePhoto {
  file_size: number | null;
  team_id: string | null;
  mini_league_id?: string | null;
}

export interface VaultStorageFile {
  file_size: number | null;
  team_id: string | null;
  mini_league_id?: string | null;
  name: string | null;
}

export interface VaultStorageTeam {
  id: string;
  name: string;
}

export interface VaultStorageMiniLeague {
  id: string;
  name: string;
}

export interface VaultStorageBucket {
  teamId: string | null;
  teamName: string;
  size: number;
  photosSize: number;
  documentsSize: number;
}

export interface VaultMiniLeagueStorageBucket {
  miniLeagueId: string;
  miniLeagueName: string;
  size: number;
  photosSize: number;
  documentsSize: number;
}

export interface VaultStorageBreakdown {
  photos: number;
  documents: number;
  total: number;
  byTeam: VaultStorageBucket[];
  byMiniLeague: VaultMiniLeagueStorageBucket[];
}

const DEFAULT_PHOTO_SIZE = 500 * 1024;
const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".heic",
  ".heif",
  ".tiff",
  ".tif",
];

function isImageFile(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function addStorage(
  map: Map<string | null, { photos: number; documents: number }>,
  key: string | null,
  kind: "photos" | "documents",
  size: number,
): void {
  const current = map.get(key) ?? { photos: 0, documents: 0 };
  current[kind] += size;
  map.set(key, current);
}

/**
 * Calculates the display/storage accounting model without deciding who may
 * read the source rows. Query and authorization boundaries remain page-owned.
 */
export function calculateVaultStorageBreakdown(input: {
  photos: readonly VaultStoragePhoto[];
  files: readonly VaultStorageFile[];
  teams: readonly VaultStorageTeam[];
  miniLeagues: readonly VaultStorageMiniLeague[];
}): VaultStorageBreakdown {
  const imageFiles = input.files.filter((file) => isImageFile(file.name ?? ""));
  const documentFiles = input.files.filter((file) => !isImageFile(file.name ?? ""));
  const photosSize =
    input.photos.reduce(
      (sum, photo) => sum + (photo.file_size || DEFAULT_PHOTO_SIZE),
      0,
    ) + imageFiles.reduce((sum, file) => sum + (file.file_size || 0), 0);
  const documentsSize = documentFiles.reduce(
    (sum, file) => sum + (file.file_size || 0),
    0,
  );

  const teamStorage = new Map<
    string | null,
    { photos: number; documents: number }
  >();
  for (const photo of input.photos) {
    if (!photo.mini_league_id) {
      addStorage(
        teamStorage,
        photo.team_id,
        "photos",
        photo.file_size || DEFAULT_PHOTO_SIZE,
      );
    }
  }
  for (const file of imageFiles) {
    if (!file.mini_league_id) {
      addStorage(teamStorage, file.team_id, "photos", file.file_size || 0);
    }
  }
  for (const file of documentFiles) {
    if (!file.mini_league_id) {
      addStorage(teamStorage, file.team_id, "documents", file.file_size || 0);
    }
  }

  const miniLeagueStorage = new Map<
    string,
    { photos: number; documents: number }
  >();
  for (const photo of input.photos) {
    if (photo.mini_league_id) {
      addStorage(
        miniLeagueStorage,
        photo.mini_league_id,
        "photos",
        photo.file_size || DEFAULT_PHOTO_SIZE,
      );
    }
  }
  for (const file of imageFiles) {
    if (file.mini_league_id) {
      addStorage(
        miniLeagueStorage,
        file.mini_league_id,
        "photos",
        file.file_size || 0,
      );
    }
  }
  for (const file of documentFiles) {
    if (file.mini_league_id) {
      addStorage(
        miniLeagueStorage,
        file.mini_league_id,
        "documents",
        file.file_size || 0,
      );
    }
  }

  const teamNames = new Map(input.teams.map((team) => [team.id, team.name]));
  const miniLeagueNames = new Map(
    input.miniLeagues.map((miniLeague) => [miniLeague.id, miniLeague.name]),
  );
  const byTeam = Array.from(teamStorage.entries())
    .map(([teamId, sizes]) => ({
      teamId,
      teamName: teamId ? teamNames.get(teamId) || "Unknown Team" : "Club-level",
      size: sizes.photos + sizes.documents,
      photosSize: sizes.photos,
      documentsSize: sizes.documents,
    }))
    .filter((team) => team.size > 0)
    .sort((left, right) => right.size - left.size);
  const byMiniLeague = Array.from(miniLeagueStorage.entries())
    .map(([miniLeagueId, sizes]) => ({
      miniLeagueId,
      miniLeagueName:
        miniLeagueNames.get(miniLeagueId) || "Unknown Mini-League",
      size: sizes.photos + sizes.documents,
      photosSize: sizes.photos,
      documentsSize: sizes.documents,
    }))
    .filter((miniLeague) => miniLeague.size > 0)
    .sort((left, right) => right.size - left.size);

  return {
    photos: photosSize,
    documents: documentsSize,
    total: photosSize + documentsSize,
    byTeam,
    byMiniLeague,
  };
}
