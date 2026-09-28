import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const uploadHookPath = join(pagesDirectory, "../features/vault/useVaultUploadWorkflow.ts");
const uploadServicePath = join(pagesDirectory, "../features/vault/vaultUploadService.ts");
const uploadHookSource = existsSync(uploadHookPath) ? readFileSync(uploadHookPath, "utf8") : "";
const uploadServiceSource = readFileSync(uploadServicePath, "utf8");
// Combine every source that could plausibly own this cluster so assertions
// below hold whether the state/mutations/handlers are still inline in the
// page or have been extracted into the typed hook (which, once extracted,
// delegates the path/reserve/settle/compensate/insert mechanics to the
// already-tested `uploadVaultItem` in vaultUploadService.ts).
const clusterSource = `${vaultPageSource}\n${uploadHookSource}\n${uploadServiceSource}`;

describe("Vault upload/file-name/quota-reservation behavior contract", () => {
  it("reserves quota atomically before any bytes are written, for both photo and file uploads", () => {
    if (!uploadHookSource) {
      expect(vaultPageSource).toMatch(
        /Reserve quota atomically before any bytes are written\.\s*\n\s*const reservationId = await reserveVaultStorage\(/,
      );
      // Appears twice: once in the photo mutation, once in the file mutation.
      const matches = vaultPageSource.match(/const reservationId = await reserveVaultStorage\(/g) ?? [];
      expect(matches.length).toBe(2);
      expect(clusterSource).toMatch(
        /reserveVaultStorage\(\s*"clubId" in currentView \? currentView\.clubId \?\? null : null,/,
      );
    } else {
      // Post-extraction: the hook's mutations call the tested `uploadVaultItem`,
      // which itself reserves storage before uploading (see vaultUploadService.test.ts),
      // deriving the same club-id-or-null scope from the view first.
      expect(uploadServiceSource).toContain(
        'const clubId = "clubId" in options.view ? options.view.clubId ?? null : null;',
      );
      expect(uploadServiceSource).toContain(
        "const reservationId = await dependencies.reserveStorage(clubId, options.file.size);",
      );
      expect(uploadHookSource).toContain("uploadVaultItem");
    }
  });

  it("constructs the exact club/team/mini-league/unassigned storage path used today", () => {
    // Whether inline or delegated to buildVaultUploadPath, the same four
    // path shapes and separators must exist somewhere in the cluster.
    expect(clusterSource).toMatch(/clubs\/\$\{.*?clubId\}\/teams\/\$\{.*?teamId\}\//);
    expect(clusterSource).toMatch(/clubs\/\$\{.*?clubId\}\/mini-leagues\/\$\{.*?miniLeagueId\}\//);
    expect(clusterSource).toMatch(/`clubs\/\$\{.*?clubId\}\/\$\{/);
    expect(clusterSource).toMatch(/unassigned\/\$\{/);
    expect(clusterSource).toMatch(/\$\{timestamp\}-\$\{randomSuffix\}\.\$\{fileExt\}/);
  });

  it("settles the reservation as failed and never inserts metadata when the storage upload itself fails", () => {
    const hasInlineFailure = /if \(uploadError\) \{\s*await settleVaultStorage\(reservationId, false\);\s*throw uploadError;\s*\}/.test(
      clusterSource,
    );
    const hasServiceFailure = /if \(uploadError\) \{\s*await dependencies\.settleStorage\(reservationId, false\);\s*throw uploadError;\s*\}/.test(
      uploadServiceSource,
    );
    expect(hasInlineFailure || hasServiceFailure).toBe(true);
  });

  it("compensates the orphaned storage object and settles as failed when the metadata insert fails", () => {
    expect(clusterSource).toMatch(/never leave an orphaned object billed against the club/);
    const hasInlineCompensation = /await compensateVaultUpload\(storagePath\);\s*await settleVaultStorage\(reservationId, false\);/.test(
      clusterSource,
    );
    const hasServiceCompensation = /await dependencies\.compensateUpload\(storagePath\);\s*await dependencies\.settleStorage\(reservationId, false\);/.test(
      uploadServiceSource,
    );
    expect(hasInlineCompensation || hasServiceCompensation).toBe(true);
  });

  it("settles the reservation as successful only after both the upload and the metadata insert succeed", () => {
    const hasInlineSettle = /await settleVaultStorage\(reservationId, true\);/.test(clusterSource);
    const hasServiceSettle = /await dependencies\.settleStorage\(reservationId, true\);/.test(uploadServiceSource);
    expect(hasInlineSettle || hasServiceSettle).toBe(true);
  });

  it("builds the public storage URL and scopes the insert to club/team/mini-league exactly like the Add Link flow", () => {
    expect(clusterSource).toMatch(/(?:buildVaultStorageUrl|dependencies\.buildStorageUrl)\(storagePath\)/);
    // Photo uploads set file_type; the file-name path never does.
    if (!uploadHookSource) {
      expect(vaultPageSource).toContain("file_type: file.type,");
    } else {
      expect(uploadServiceSource).toContain('if (options.kind === "photo") insert.file_type = options.file.type;');
    }
  });

  it("resolves the uploaded file name with the exact fallback order used today", () => {
    expect(clusterSource).toMatch(/customFileName \|\| fileName \|\| file\.name/);
  });

  it("invalidates the exact cache scopes on success: files/clubs/storageBreakdown for both, plus clubFreeUsage for file uploads", () => {
    const scopeMatches = clusterSource.match(/invalidateVaultCache\(queryClient, \["files", "clubs", "storageBreakdown"\]\);/g) ?? [];
    expect(scopeMatches.length).toBeGreaterThanOrEqual(2);
    expect(clusterSource).toContain('invalidateVaultCache(queryClient, ["clubFreeUsage"]);');
  });

  it("closes the upload dialog on success for both photo and file uploads, but only resets fileName and toasts success for file uploads", () => {
    const closeMatches = clusterSource.match(/setUploadDialogOpen\(false\);/g) ?? [];
    expect(closeMatches.length).toBeGreaterThanOrEqual(2);
    expect(clusterSource).toContain('setFileName("");');
    expect(clusterSource).toContain('toast.success("File uploaded successfully!");');
    // Photo success intentionally has no toast (see the comment preserved below).
    expect(clusterSource).toMatch(/No toast for successful photo uploads/);
  });

  it("reports upload failures with the exact fallback error toasts", () => {
    expect(clusterSource).toContain('toast.error(error.message || "Failed to upload photo");');
    expect(clusterSource).toContain('toast.error(error.message || "Failed to upload file");');
  });

  it("tracks a single uploading flag around both the raw input and dialog upload paths, using try/finally for the dialog path", () => {
    expect(clusterSource).toMatch(/setUploading\(true\);\s*if \(uploadType === "photo"\) \{\s*await uploadPhotoMutation\.mutateAsync\(file\);\s*\} else \{\s*await uploadFileMutation\.mutateAsync\(\{ file \}\);\s*\}\s*setUploading\(false\);/);
    expect(clusterSource).toMatch(/setUploading\(true\);\s*try \{\s*if \(type === "photo"\) \{\s*await uploadPhotoMutation\.mutateAsync\(file\);\s*\} else \{\s*await uploadFileMutation\.mutateAsync\(\{ file, customFileName \}\);\s*\}\s*\} finally \{\s*setUploading\(false\);\s*\}/);
  });

  it("keeps any extracted Vault upload boundary narrow when present", () => {
    if (!uploadHookSource) {
      expect(vaultPageSource).toMatch(/\[uploadDialogOpen, setUploadDialogOpen\]/);
      expect(vaultPageSource).toMatch(/\[uploading, setUploading\]/);
      expect(vaultPageSource).toMatch(/\[fileName, setFileName\]/);
      expect(vaultPageSource).toContain("handleDialogUpload");
      return;
    }

    expect(uploadHookSource).toContain("useVaultUploadWorkflow");
    expect(uploadHookSource).not.toContain("supabase.storage");
    expect(uploadHookSource).not.toContain("useQuery");
    expect(vaultPageSource).toContain("useVaultUploadWorkflow");
    expect(vaultPageSource).not.toMatch(/\[uploadDialogOpen, setUploadDialogOpen\]/);
    expect(vaultPageSource).not.toMatch(/\[uploading, setUploading\]/);
    expect(vaultPageSource).not.toMatch(/\[fileName, setFileName\]/);
  });

  it("keeps the upload dialog wiring, canUpload gate, and unrelated Vault clusters untouched by this extraction", () => {
    expect(vaultPageSource).toContain("<UploadFilesDialog");
    expect(vaultPageSource).toContain("open={uploadDialogOpen}");
    expect(vaultPageSource).toContain("onOpenChange={setUploadDialogOpen}");
    expect(vaultPageSource).toContain("onUpload={handleDialogUpload}");
    expect(vaultPageSource).toContain("isUploading={uploading}");
    expect(vaultPageSource).toContain("canUpload &&");
    // Drive/Add Link, storage purchase, trash/recovery, export/large-files,
    // lightbox, bulk-delete, and folder/file management remain their own
    // extracted hooks/dialogs and are not touched by this cluster.
    expect(vaultPageSource).toContain("useVaultDriveLinkWorkflow");
    expect(vaultPageSource).toContain("useVaultTrashWorkflow({");
    expect(vaultPageSource).toContain("useVaultExport({");
    expect(vaultPageSource).toContain("useVaultLargeFiles(");
    expect(vaultPageSource).toContain("useVaultLightbox(");
    expect(vaultPageSource).toContain("useVaultBulkDeleteWorkflow(");
    expect(vaultPageSource).toContain("useVaultFolderManagement(");
    expect(vaultPageSource).toContain("storagePurchaseDialogOpen");
  });
});
