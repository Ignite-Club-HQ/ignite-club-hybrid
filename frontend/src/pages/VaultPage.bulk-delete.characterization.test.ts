import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const bulkHookPath = join(pagesDirectory, "../features/vault/useVaultBulkDeleteWorkflow.ts");
const bulkDialogPath = join(pagesDirectory, "../components/vault/VaultBulkDeleteDialog.tsx");
const bulkMutationServicePath = join(pagesDirectory, "../features/vault/vaultBulkMutationService.ts");
const bulkHookSource = existsSync(bulkHookPath) ? readFileSync(bulkHookPath, "utf8") : "";
const bulkDialogSource = existsSync(bulkDialogPath) ? readFileSync(bulkDialogPath, "utf8") : "";
const bulkMutationServiceSource = readFileSync(bulkMutationServicePath, "utf8");
// Combine every source that could plausibly own this cluster so assertions
// below hold whether the state/handlers are still inline in the page or have
// been extracted into the typed hook/dialog module.
const clusterSource = `${vaultPageSource}\n${bulkHookSource}\n${bulkDialogSource}`;

describe("Vault bulk selection/delete behavior contract", () => {
  it("toggles individual photo and file selection by id without touching the other set", () => {
    expect(clusterSource).toMatch(/setSelectedPhotos\(\s*\(?prev\)? => \{/);
    expect(clusterSource).toContain("newSet.delete(photoId)");
    expect(clusterSource).toContain("newSet.add(photoId)");
    expect(clusterSource).toMatch(/setSelectedFiles\(\s*\(?prev\)? => \{/);
    expect(clusterSource).toContain("newSet.delete(fileId)");
    expect(clusterSource).toContain("newSet.add(fileId)");
  });

  it("selects every visible photo and file and derives the count from both sets", () => {
    expect(clusterSource).toMatch(/setSelectedPhotos\(new Set\(\(?photos(?:\s*\|\|\s*\[\])?\)?\.map\(\(?p\)? => p\.id\)\)\)/);
    expect(clusterSource).toMatch(/setSelectedFiles\(new Set\(\(?files(?:\s*\|\|\s*\[\])?\)?\.map\(\(?f\)? => f\.id\)\)\)/);
    expect(clusterSource).toContain("selectedPhotos.size + selectedFiles.size");
  });

  it("resets selection mode and both selected sets together on exit", () => {
    expect(clusterSource).toMatch(
      /exitSelectionMode = (?:\(\)|useCallback\(\(\))\s*=>\s*\{\s*setSelectionMode\(false\);\s*setSelectedPhotos\(new Set\(\)\);\s*setSelectedFiles\(new Set\(\)\);/,
    );
  });

  it("soft-deletes photos before files, reusing the tested bulk mutation service once extracted", () => {
    expect(bulkMutationServiceSource).toContain("for (const id of options.photoIds)");
    expect(bulkMutationServiceSource).toContain("for (const id of options.fileIds)");

    if (!bulkHookSource) {
      // Pre-extraction: the page loops photos then files inline.
      expect(vaultPageSource).toMatch(/for \(const photo of selectedPhotoItems\)[\s\S]*for \(const file of selectedFileItems\)/);
      return;
    }

    // Post-extraction: the hook delegates to the tested service instead of
    // re-inlining per-item Supabase calls.
    expect(clusterSource).toContain("softDeleteVaultSelection");
    expect(clusterSource).not.toMatch(/for \(const photo of selectedPhotoItems\)/);
  });

  it("reports truthful success/partial/failure toasts with the exact existing wording", () => {
    expect(clusterSource).toContain("`Moved ${deletedCount} items to trash`");
    expect(clusterSource).toContain("`Moved ${deletedCount} items to trash, ${errorCount} failed`");
    expect(clusterSource).toContain('error.message || "Failed to delete items"');
    expect(clusterSource).toMatch(/invalidateVaultCache\(queryClient, \["files", "photos", "storageBreakdown"\]\)/);
  });

  it("clears the removed-photo media cache and always closes/exits after the attempt", () => {
    expect(clusterSource).toContain("removePhotoFromCache(");
    expect(clusterSource).toMatch(/finally\s*\{\s*setIsDeletingSelected\(false\);\s*setBulkDeleteDialogOpen\(false\);\s*exitSelectionMode\(\);/);
  });

  it("keeps the confirmation dialog's exact copy, disabled-while-deleting, and cancel semantics", () => {
    expect(clusterSource).toContain("Delete Selected Items");
    expect(clusterSource).toContain(
      "Are you sure you want to delete {selectedCount} selected item{selectedCount !== 1 ? 's' : ''}? This action cannot be undone.",
    );
    expect(clusterSource).toMatch(/AlertDialogCancel disabled=\{isDeleting(?:Selected)?\}/);
    expect(clusterSource).toMatch(/disabled=\{isDeleting(?:Selected)?\}/);
    expect(clusterSource).toContain("Deleting...");
  });

  it("keeps any extracted Vault bulk selection/delete boundary narrow when present", () => {
    if (!bulkHookSource && !bulkDialogSource) {
      expect(vaultPageSource).toMatch(/\[selectionMode, setSelectionMode\]/);
      expect(vaultPageSource).toMatch(/\[selectedPhotos, setSelectedPhotos\]/);
      expect(vaultPageSource).toMatch(/\[selectedFiles, setSelectedFiles\]/);
      expect(vaultPageSource).toMatch(/\[bulkDeleteDialogOpen, setBulkDeleteDialogOpen\]/);
      expect(vaultPageSource).toContain("deleteSelectedItems");
      return;
    }

    expect(bulkHookSource).toContain("useVaultBulkDeleteWorkflow");
    expect(bulkHookSource).not.toContain("supabase");
    expect(bulkHookSource).not.toContain("useQuery");
    expect(bulkDialogSource).toContain("AlertDialog");
    expect(bulkDialogSource).not.toContain("supabase");
    expect(bulkDialogSource).not.toContain("useState");
    expect(vaultPageSource).toContain("useVaultBulkDeleteWorkflow");
    expect(vaultPageSource).not.toMatch(/\[selectionMode, setSelectionMode\]/);
    expect(vaultPageSource).not.toMatch(/\[selectedPhotos, setSelectedPhotos\]/);
    expect(vaultPageSource).not.toMatch(/\[selectedFiles, setSelectedFiles\]/);
    expect(vaultPageSource).not.toMatch(/\[bulkDeleteDialogOpen, setBulkDeleteDialogOpen\]/);
  });

  it("keeps upload, folder/file rename-move, Drive import, export/large-files, trash/recovery, and lightbox untouched by this cluster", () => {
    // Bulk selection/delete only reaches these features through the stable
    // `photos`/`files`/`selectionMode`/`selectedPhotos`/`selectedFiles`/
    // `exitSelectionMode` contract already consumed by useVaultExport.
    expect(vaultPageSource).toContain("useVaultExport({");
    expect(vaultPageSource).toContain("useVaultLargeFiles(");
    expect(vaultPageSource).toContain("useVaultTrashWorkflow({");
    expect(vaultPageSource).toContain("useVaultLightbox(");
    // Phase 4A subsequently moved Google Drive import/link/title resolution
    // into useVaultDriveLinkWorkflow + VaultDriveLinkDialogs (see
    // VaultPage.drive-link.characterization.test.ts); the page only consumes
    // that hook's outputs now.
    expect(vaultPageSource).toContain("useVaultDriveLinkWorkflow");
    expect(vaultPageSource).toContain("VaultDriveLinkDialogs");
    expect(vaultPageSource).not.toContain("GoogleDriveImportDialog");
    // Phase 4A subsequently moved folder/file rename-move into
    // useVaultFolderManagement (see VaultPage.folder-management.characterization.test.ts);
    // the page only consumes that hook's outputs now.
    expect(vaultPageSource).toContain("useVaultFolderManagement");
    expect(vaultPageSource).toContain("moveFileMutation");
  });
});
