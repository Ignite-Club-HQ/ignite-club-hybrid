import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const exportHookSource = readFileSync(join(pagesDirectory, "../features/vault/useVaultExport.ts"), "utf8");
const exportDialogSource = readFileSync(join(pagesDirectory, "../components/vault/VaultExportDialogs.tsx"), "utf8");
const largeFilesHookSource = readFileSync(join(pagesDirectory, "../features/vault/useVaultLargeFiles.ts"), "utf8");
const largeFilesDialogSource = readFileSync(join(pagesDirectory, "../components/vault/VaultLargeFilesDialog.tsx"), "utf8");
const largeFilesRepositorySource = readFileSync(join(pagesDirectory, "../features/vault/vaultLargeFileRepository.ts"), "utf8");

describe("Vault export and large-file behavior contract", () => {
  it("keeps export state, confirmation, and abort/progress paths together", () => {
    expect(exportHookSource).toMatch(/\[isExporting, setIsExporting\]/);
    expect(exportHookSource).toMatch(/\[exportProgress, setExportProgress\]/);
    expect(exportHookSource).toContain("exportAbortController.current?.abort()");
    expect(exportHookSource).toContain("setExportPreviewOpen(true)");
    expect(exportHookSource).toContain("setExcludedFolders(new Set())");
    expect(exportHookSource).toContain("setExportConfirmOpen(true)");
    expect(exportHookSource).toContain('pendingExportAction.type === "zipAll"');
    expect(exportHookSource).toContain("runZipExport(items, {");
    expect(exportHookSource).toContain("summarizeZipExport(result)");
    expect(exportHookSource).toContain('toast.info("Export cancelled")');
    expect(exportHookSource).toContain('toast.error("Failed to create ZIP file")');
  });

  it("preserves recursive folder exclusion and single-item versus ZIP behavior", () => {
    expect(exportHookSource).toContain("collectVaultExportContents");
    expect(exportHookSource).toContain("excludeVaultExportFolders");
    expect(exportHookSource).toContain("filteredExportData");
    expect(exportHookSource).toContain("if (totalItems > 1)");
    expect(exportHookSource).toContain('toast.success("Downloaded file")');
    expect(exportDialogSource).toContain("Export ZIP");
    expect(exportDialogSource).toContain("Export All Folders");
    expect(exportDialogSource).toContain("Export: {folderData?.folderName}");
  });

  it("keeps large-file reads club-scoped and deletes only acknowledged IDs", () => {
    expect(largeFilesRepositorySource).toContain('from("teams")');
    expect(largeFilesRepositorySource).toContain('from("photos")');
    expect(largeFilesRepositorySource).toContain('from("vault_files")');
    expect(largeFilesRepositorySource).toContain('.eq("club_id", clubId)');
    expect(largeFilesHookSource).toContain("permanentlyDeleteVaultItems");
    expect(largeFilesHookSource).toContain("summarizeVaultDeletion");
    expect(largeFilesHookSource).toContain("deletedIds.has(id)");
    expect(largeFilesHookSource).toContain('invalidateVaultCache(queryClient, ["storageBreakdown"]);');
    expect(largeFilesHookSource).toContain('toast.error("Failed to load large files")');
    expect(largeFilesDialogSource).toContain("Manage Large Files");
  });

  it("delegates bulk selection/delete to its own extracted workflow (see VaultPage.bulk-delete.characterization.test.ts)", () => {
    // Phase 4A moved this cluster out of the page into
    // useVaultBulkDeleteWorkflow; the page only consumes the hook's outputs.
    expect(pageSource).toContain("useVaultBulkDeleteWorkflow");
    expect(pageSource).not.toMatch(/\[selectionMode, setSelectionMode\]/);
    expect(pageSource).not.toMatch(/\[selectedPhotos, setSelectedPhotos\]/);
    expect(pageSource).not.toMatch(/\[selectedFiles, setSelectedFiles\]/);
    expect(pageSource).not.toMatch(/\[bulkDeleteDialogOpen, setBulkDeleteDialogOpen\]/);
  });
});
