export interface VaultSelectableItem {
  id: string;
}

export interface VaultExportPathItem extends VaultSelectableItem {
  path?: string | null;
}

export interface VaultExportSelection<TPhoto, TFile> {
  photos: TPhoto[];
  files: TFile[];
}

export interface VaultExportSummary {
  photoCount: number;
  fileCount: number;
  isSelection: boolean;
}

export const CURRENT_VAULT_EXPORT_FOLDER = "(current folder)";

/** Return a fresh Set so React state is never mutated in place. */
export function toggleVaultExportSelection(
  selectedIds: ReadonlySet<string>,
  itemId: string,
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  return next;
}

export function selectAllVaultExportItems(
  items: ReadonlyArray<VaultSelectableItem>,
): Set<string> {
  return new Set(items.map(({ id }) => id));
}

export function resolveSelectedVaultExportItems<
  TPhoto extends VaultSelectableItem,
  TFile extends VaultSelectableItem,
>(
  photos: ReadonlyArray<TPhoto>,
  files: ReadonlyArray<TFile>,
  selectedPhotoIds: ReadonlySet<string>,
  selectedFileIds: ReadonlySet<string>,
): VaultExportSelection<TPhoto, TFile> {
  return {
    photos: photos.filter(({ id }) => selectedPhotoIds.has(id)),
    files: files.filter(({ id }) => selectedFileIds.has(id)),
  };
}

export function excludeVaultExportFolders<
  TPhoto extends VaultExportPathItem,
  TFile extends VaultExportPathItem,
>(
  photos: ReadonlyArray<TPhoto>,
  files: ReadonlyArray<TFile>,
  excludedFolders: ReadonlySet<string>,
): VaultExportSelection<TPhoto, TFile> {
  const isIncluded = ({ path }: VaultExportPathItem) =>
    !excludedFolders.has(path || CURRENT_VAULT_EXPORT_FOLDER);
  return {
    photos: photos.filter(isIncluded),
    files: files.filter(isIncluded),
  };
}

export function summarizeVaultExport(
  selectionMode: boolean,
  photos: ReadonlyArray<unknown>,
  files: ReadonlyArray<unknown>,
  selectedPhotoIds: ReadonlySet<string>,
  selectedFileIds: ReadonlySet<string>,
): VaultExportSummary {
  return selectionMode
    ? {
        photoCount: selectedPhotoIds.size,
        fileCount: selectedFileIds.size,
        isSelection: true,
      }
    : {
        photoCount: photos.length,
        fileCount: files.length,
        isSelection: false,
      };
}
