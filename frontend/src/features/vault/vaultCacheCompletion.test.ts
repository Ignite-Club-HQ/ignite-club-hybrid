import { describe, expect, it, vi } from "vitest";
import {
  refreshGalleryUpload,
  refreshVaultBulkDelete,
  refreshVaultFileStorage,
  refreshVaultFolders,
  refreshVaultImportedContent,
  refreshVaultPermanentDelete,
  refreshVaultRestore,
  refreshVaultUpload,
} from "./vaultCacheCompletion";

function client() {
  return { invalidateQueries: vi.fn() };
}

function invalidated(queryClient: ReturnType<typeof client>) {
  return queryClient.invalidateQueries.mock.calls.map(([filters]) => filters.queryKey);
}

describe("Vault cache completion policies", () => {
  it("refreshes only the folder listing after a folder mutation", () => {
    const queryClient = client();
    refreshVaultFolders(queryClient);
    expect(invalidated(queryClient)).toEqual([["vault-subfolders"]]);
  });

  it("preserves the different photo and file upload refresh breadth", () => {
    const photoClient = client();
    refreshVaultUpload(photoClient, { includeFreeUsage: false });
    expect(invalidated(photoClient)).toEqual([
      ["vault-files"],
      ["vault-clubs"],
      ["storage-breakdown"],
    ]);

    const fileClient = client();
    refreshVaultUpload(fileClient, { includeFreeUsage: true });
    expect(invalidated(fileClient)).toEqual([
      ["vault-files"],
      ["vault-clubs"],
      ["storage-breakdown"],
      ["club-free-usage"],
    ]);
  });

  it("preserves soft-delete, restore and permanent-delete refresh rules", () => {
    const softDeleteClient = client();
    refreshVaultFileStorage(softDeleteClient);
    expect(invalidated(softDeleteClient)).toEqual([["vault-files"], ["storage-breakdown"]]);

    const restoreClient = client();
    refreshVaultRestore(restoreClient);
    expect(invalidated(restoreClient)).toEqual([["vault-trash"], ["vault-files"]]);

    const photoClient = client();
    refreshVaultPermanentDelete(photoClient, { includePhotos: true });
    expect(invalidated(photoClient)).toEqual([
      ["vault-trash"], ["vault-files"], ["storage-breakdown"], ["photos"],
    ]);

    const fileClient = client();
    refreshVaultPermanentDelete(fileClient, { includePhotos: false });
    expect(invalidated(fileClient)).toEqual([
      ["vault-trash"], ["vault-files"], ["storage-breakdown"],
    ]);
  });

  it("keeps bulk-delete and imported-content boundaries distinct", () => {
    const bulkClient = client();
    refreshVaultBulkDelete(bulkClient);
    expect(invalidated(bulkClient)).toEqual([
      ["vault-files"], ["photos"], ["storage-breakdown"],
    ]);

    const importClient = client();
    refreshVaultImportedContent(importClient);
    expect(invalidated(importClient)).toEqual([["vault-files"], ["vault-folders"]]);
  });

  it("refreshes gallery and Vault consumers after a gallery upload", () => {
    const queryClient = client();
    refreshGalleryUpload(queryClient);
    expect(invalidated(queryClient)).toEqual([
      ["photos"],
      ["vault-files"],
      ["storage-breakdown"],
      ["club-free-usage"],
    ]);
  });
});
