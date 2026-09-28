export type VaultLargeFileType = "photo" | "file";
export type VaultLargeFileSort = "size" | "date" | "type";

export interface VaultLargeFileItem {
  id: string;
  type: VaultLargeFileType;
  name: string;
  size: number;
  url: string;
  teamName?: string;
  createdAt: string;
}

export interface VaultLargeFileTeam {
  id: string;
  name: string;
}

export interface VaultLargePhotoRow {
  id: string;
  file_url: string;
  file_size: number | null;
  team_id: string | null;
  title: string | null;
  created_at: string;
}

export interface VaultLargeFileRow {
  id: string;
  file_url: string;
  file_size: number | null;
  team_id: string | null;
  name: string | null;
  created_at: string;
}

export interface VaultLargeFileDeletion {
  items: VaultLargeFileItem[];
  photoIds: string[];
  fileIds: string[];
  selectedBytes: number;
}

export function buildVaultLargeFileItems(
  teams: ReadonlyArray<VaultLargeFileTeam>,
  photos: ReadonlyArray<VaultLargePhotoRow>,
  files: ReadonlyArray<VaultLargeFileRow>,
  limit = 50,
): VaultLargeFileItem[] {
  const teamNames = new Map<string | null, string>(
    teams.map(({ id, name }) => [id, name]),
  );
  teamNames.set(null, "Club-level");

  const items: VaultLargeFileItem[] = [
    ...photos.map((photo) => ({
      id: photo.id,
      type: "photo" as const,
      name: photo.title || "Photo",
      size: photo.file_size || 0,
      url: photo.file_url,
      teamName: teamNames.get(photo.team_id),
      createdAt: photo.created_at,
    })),
    ...files.map((file) => ({
      id: file.id,
      type: "file" as const,
      name: file.name || "File",
      size: file.file_size || 0,
      url: file.file_url,
      teamName: teamNames.get(file.team_id),
      createdAt: file.created_at,
    })),
  ];

  return sortVaultLargeFileItems(items, "size").slice(0, limit);
}

/** Always return a copy so rendering never mutates cached query data. */
export function sortVaultLargeFileItems(
  items: ReadonlyArray<VaultLargeFileItem>,
  sortBy: VaultLargeFileSort,
): VaultLargeFileItem[] {
  return [...items].sort((left, right) => {
    if (sortBy === "size") return right.size - left.size;
    if (sortBy === "date") {
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    }
    return left.type.localeCompare(right.type);
  });
}

export function prepareVaultLargeFileDeletion(
  items: ReadonlyArray<VaultLargeFileItem>,
  selectedIds: ReadonlySet<string>,
): VaultLargeFileDeletion {
  const selectedItems = items.filter(({ id }) => selectedIds.has(id));
  return {
    items: selectedItems,
    photoIds: selectedItems.filter(({ type }) => type === "photo").map(({ id }) => id),
    fileIds: selectedItems.filter(({ type }) => type === "file").map(({ id }) => id),
    selectedBytes: selectedItems.reduce((total, { size }) => total + size, 0),
  };
}
