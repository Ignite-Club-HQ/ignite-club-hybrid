import { vaultKeys } from "./vaultQueryKeys";

type VaultQueryClient = {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
};

function invalidate(queryClient: VaultQueryClient, queryKey: readonly unknown[]) {
  void queryClient.invalidateQueries({ queryKey });
}

export function refreshVaultFolders(queryClient: VaultQueryClient) {
  invalidate(queryClient, vaultKeys.subfolders());
}

export function refreshVaultFiles(queryClient: VaultQueryClient) {
  invalidate(queryClient, vaultKeys.files());
}

export function refreshVaultUpload(
  queryClient: VaultQueryClient,
  options: { includeFreeUsage: boolean },
) {
  invalidate(queryClient, vaultKeys.files());
  invalidate(queryClient, vaultKeys.clubs());
  invalidate(queryClient, vaultKeys.storageBreakdown());
  if (options.includeFreeUsage) {
    invalidate(queryClient, vaultKeys.clubFreeUsage());
  }
}

export function refreshVaultFileStorage(queryClient: VaultQueryClient) {
  invalidate(queryClient, vaultKeys.files());
  invalidate(queryClient, vaultKeys.storageBreakdown());
}

export function refreshVaultRestore(queryClient: VaultQueryClient) {
  invalidate(queryClient, vaultKeys.trash());
  invalidate(queryClient, vaultKeys.files());
}

export function refreshVaultPermanentDelete(
  queryClient: VaultQueryClient,
  options: { includePhotos: boolean },
) {
  invalidate(queryClient, vaultKeys.trash());
  invalidate(queryClient, vaultKeys.files());
  invalidate(queryClient, vaultKeys.storageBreakdown());
  if (options.includePhotos) {
    invalidate(queryClient, vaultKeys.photos());
  }
}

export function refreshVaultBulkDelete(queryClient: VaultQueryClient) {
  invalidate(queryClient, vaultKeys.files());
  invalidate(queryClient, vaultKeys.photos());
  invalidate(queryClient, vaultKeys.storageBreakdown());
}

export function refreshGalleryUpload(queryClient: VaultQueryClient) {
  invalidate(queryClient, vaultKeys.photos());
  invalidate(queryClient, vaultKeys.files());
  invalidate(queryClient, vaultKeys.storageBreakdown());
  invalidate(queryClient, vaultKeys.clubFreeUsage());
}

export function refreshVaultImportedContent(queryClient: VaultQueryClient) {
  invalidate(queryClient, vaultKeys.files());
  invalidate(queryClient, vaultKeys.folders());
}
