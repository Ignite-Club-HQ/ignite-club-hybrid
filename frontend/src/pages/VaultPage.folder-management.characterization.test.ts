import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const folderHookPath = join(pagesDirectory, "../features/vault/useVaultFolderManagement.ts");
const folderDialogsPath = join(pagesDirectory, "../components/vault/VaultFolderManagementDialogs.tsx");
const mutationRepositorySource = readFileSync(join(pagesDirectory, "../features/vault/vaultMutationRepository.ts"), "utf8");
const vaultScopeSource = readFileSync(join(pagesDirectory, "../features/vault/vaultScope.ts"), "utf8");
const folderHookSource = existsSync(folderHookPath) ? readFileSync(folderHookPath, "utf8") : "";
const folderDialogsSource = existsSync(folderDialogsPath) ? readFileSync(folderDialogsPath, "utf8") : "";
// Combine every source that could plausibly own this cluster so assertions
// below hold whether the state/handlers are still inline in the page or have
// been extracted into the typed hook/dialogs module.
const clusterSource = `${vaultPageSource}\n${folderHookSource}\n${folderDialogsSource}`;

describe("Vault folder/file management and navigation behavior contract", () => {
  it("creates a folder under the current parent/view and reports exact success/failure toasts", () => {
    expect(clusterSource).toMatch(/parentFolderId: getCurrentFolderId\(\)/);
    expect(clusterSource).toMatch(/view: currentView/);
    expect(clusterSource).toMatch(/invalidateVaultCache\(queryClient, \["subfolders"\]\)/);
    expect(clusterSource).toContain('toast.success("Folder created!")');
    expect(clusterSource).toContain('error.message || "Failed to create folder"');
  });

  it("deletes only the requested folder id and reports exact success/failure toasts", () => {
    expect(clusterSource).toMatch(/deleteFolderMutation = useMutation\(\{\s*mutationFn: async \(folderId: string\) => \{\s*await deleteVaultFolder\(folderId\);/);
    expect(clusterSource).toContain('toast.success("Folder deleted")');
    expect(clusterSource).toContain('error.message || "Failed to delete folder"');
  });

  it("renames a folder, updates any matching folderPath breadcrumb entry, and reports exact toasts", () => {
    expect(clusterSource).toMatch(
      /f\.id === variables\.folderId \? \{ \.\.\.f, name: variables\.newName \} : f/,
    );
    expect(clusterSource).toContain('toast.success("Folder renamed")');
    expect(clusterSource).toContain('error.message || "Failed to rename folder"');
  });

  it("renames a file/photo through the shared renameVaultItem repository call with distinct toasts", () => {
    expect(mutationRepositorySource).toContain("export function renameVaultItem(");
    expect(clusterSource).toContain("renameVaultItem(fileId, newName)");
    expect(clusterSource).toContain("renameVaultItem(photoId, newName)");
    expect(clusterSource).toContain('toast.success("File renamed")');
    expect(clusterSource).toContain('error.message || "Failed to rename file"');
    expect(clusterSource).toContain('toast.success("Photo renamed")');
    expect(clusterSource).toContain('error.message || "Failed to rename photo"');
    expect(clusterSource).toMatch(/invalidateVaultCache\(queryClient, \["files"\]\)/);
  });

  it("moves a file, updating team_id only when explicitly provided, and clears dialog state on success", () => {
    if (!folderHookSource) {
      // Pre-extraction: the page inlines the Supabase update itself.
      expect(vaultPageSource).toMatch(/if \(targetTeamId !== undefined\)/);
    } else {
      // Post-extraction: reuses the already-tested repository function
      // instead of re-inlining the Supabase call.
      expect(folderHookSource).toContain("moveVaultFile({ fileId, targetFolderId, targetTeamId })");
      expect(mutationRepositorySource).toContain("export async function moveVaultFile(");
      expect(mutationRepositorySource).toMatch(/if \(options\.targetTeamId !== undefined\) update\.team_id = options\.targetTeamId;/);
    }
    expect(clusterSource).toContain('toast.success("File moved successfully")');
    expect(clusterSource).toContain('error.message || "Failed to move file"');
    expect(clusterSource).toMatch(/setMoveFileDialogOpen\(false\)/);
    expect(clusterSource).toMatch(/setFileToMove\(null\)/);
  });

  it("navigates into a folder for club/team views by pushing folderPath and updating currentView", () => {
    expect(clusterSource).toMatch(/currentView\.type === "club"/);
    expect(clusterSource).toMatch(/folderPath, folder\]|\[\.\.\.folderPath, folder\]/);
    expect(clusterSource).toMatch(/folderId: folder\.id,\s*folderName: folder\.name,/);
  });

  it("goes back via fromChat history, folderPath pop, or the club/root fallback, in that priority order", () => {
    expect(clusterSource).toMatch(/if \(fromChat\) \{\s*navigate\(-1\);\s*return;\s*\}/);
    expect(clusterSource).toMatch(/if \(folderPath\.length > 0\) \{/);
    expect(clusterSource).toContain("newPath.pop()");
    expect(clusterSource).toMatch(/setCurrentView\(\{ type: "club", clubId: currentView\.clubId, clubName: currentView\.clubName \}\)/);
    expect(clusterSource).toMatch(/setCurrentView\(\{ type: "root" \}\)/);
  });

  it("clears folderPath on root/club/mini-league/team breadcrumb jumps and slices it for interior crumbs", () => {
    expect(clusterSource).toMatch(/navigateToRoot[\s\S]{0,120}setFolderPath\(\[\]\)/);
    expect(clusterSource).toMatch(/navigateToClub[\s\S]{0,200}setFolderPath\(\[\]\)/);
    expect(clusterSource).toContain("folderPath.slice(0, index + 1)");
  });

  it("builds hierarchy breadcrumb nodes for vault root, club/team, mini-league, and each folder in the path", () => {
    expect(clusterSource).toContain('key: "vault", label: "Vault"');
    expect(clusterSource).toContain('key: "club"');
    expect(clusterSource).toContain('key: "team"');
    expect(clusterSource).toContain('key: "mini-league"');
    expect(clusterSource).toContain("key: `folder-${folder.id}`");
    if (!folderHookSource) {
      // Pre-extraction: the page abbreviates club names inline.
      expect(vaultPageSource).toContain("Soccer Club");
    } else {
      // Post-extraction: reuses the already-tested vaultScope abbreviator
      // instead of re-inlining the club-suffix regex table.
      expect(folderHookSource).toContain("abbreviateVaultOrganisationName");
      expect(vaultScopeSource).toContain("export function abbreviateVaultOrganisationName(");
      expect(vaultScopeSource).toContain("Soccer Club");
    }
  });

  it("keeps the create-folder dialog wired to the mutation's pending state and dialog-open callback", () => {
    expect(clusterSource).toContain("<CreateFolderDialog");
    expect(clusterSource).toMatch(/isCreating(Folder)?=\{createFolderMutation\.isPending\}/);
  });

  it("keeps the delete-folder confirmation copy, cancel, and destructive confirm action exact", () => {
    expect(clusterSource).toContain("Delete Folder");
    expect(clusterSource).toContain(
      "Are you sure you want to delete this folder? Files inside will be moved to the parent folder.",
    );
    expect(clusterSource).toContain("bg-destructive text-destructive-foreground hover:bg-destructive/90");
  });

  it("keeps rename dialogs' exact copy and blank-name disabled state for folder, file, and photo", () => {
    expect(clusterSource).toContain("Rename Folder");
    expect(clusterSource).toContain("Enter new folder name");
    expect(clusterSource).toMatch(/disabled=\{!renameFolderName\.trim\(\)\}/);
    expect(clusterSource).toContain("Rename File");
    expect(clusterSource).toContain("Enter new file name");
    expect(clusterSource).toMatch(/disabled=\{!renameFileName\.trim\(\)\}/);
    expect(clusterSource).toContain("Rename Photo");
    expect(clusterSource).toContain("Enter new photo title");
    expect(clusterSource).toMatch(/disabled=\{!renamePhotoName\.trim\(\)\}/);
  });

  it("keeps MoveFileDialog lazily loaded with the exact team/club scope and pending-move wiring", () => {
    expect(clusterSource).toContain('import("@/components/vault/MoveFileDialog")');
    expect(clusterSource).toMatch(/currentView\.type === "team" \? currentView\.teamId : null/);
    expect(clusterSource).toMatch(/currentView\.type === "club" \|\| currentView\.type === "team"[\s\S]{0,20}\? currentView\.clubId : null/);
  });

  it("keeps any extracted Vault folder/file management boundary narrow when present", () => {
    const pageUsesExtractedBoundary = vaultPageSource.includes("useVaultFolderManagement");
    if (!pageUsesExtractedBoundary) {
      expect(vaultPageSource).toMatch(/\[folderPath, setFolderPath\]/);
      expect(vaultPageSource).toMatch(/\[deleteFolderId, setDeleteFolderId\]/);
      expect(vaultPageSource).toMatch(/\[renameFolderId, setRenameFolderId\]/);
      expect(vaultPageSource).toMatch(/\[moveFileDialogOpen, setMoveFileDialogOpen\]/);
      return;
    }

    expect(folderHookSource).toContain("useVaultFolderManagement");
    expect(folderHookSource).not.toContain("<Dialog");
    expect(folderDialogsSource).not.toContain("useState");
    expect(folderDialogsSource).not.toContain("useMutation");
    expect(vaultPageSource).toContain("useVaultFolderManagement");
    expect(vaultPageSource).toContain("VaultFolderManagementDialogs");
    expect(vaultPageSource).not.toMatch(/\[folderPath, setFolderPath\]/);
    expect(vaultPageSource).not.toMatch(/\[deleteFolderId, setDeleteFolderId\]/);
    expect(vaultPageSource).not.toMatch(/\[renameFolderId, setRenameFolderId\]/);
    expect(vaultPageSource).not.toMatch(/\[moveFileDialogOpen, setMoveFileDialogOpen\]/);
  });

  it("keeps upload, add-link, Drive import/link/title resolution, storage purchase, export/large-files, trash/recovery, lightbox, and bulk-delete untouched by this cluster", () => {
    // Upload/file-name flow was subsequently extracted into
    // `useVaultUploadWorkflow` by a later Phase 4A round (see
    // VaultPage.upload.characterization.test.ts); this folder/file
    // management cluster only needs to not have re-absorbed it.
    expect(vaultPageSource).toContain("useVaultUploadWorkflow");
    expect(vaultPageSource).not.toContain("uploadPhotoMutation");
    expect(vaultPageSource).not.toContain("uploadFileMutation");
    // Add Link / Google Drive import/link/title resolution were later
    // extracted into their own cluster (`useVaultDriveLinkWorkflow` +
    // `VaultDriveLinkDialogs`) by a subsequent Phase 4A round; this folder/
    // file management cluster only needs to not have re-absorbed them.
    expect(vaultPageSource).toContain("addLinkMutation");
    expect(vaultPageSource).toContain("useVaultDriveLinkWorkflow");
    expect(vaultPageSource).toContain("VaultDriveLinkDialogs");
    expect(vaultPageSource).not.toContain("GoogleDriveImportDialog");
    expect(vaultPageSource).not.toContain("LinkDriveFolderDialog");
    expect(vaultPageSource).not.toContain("resolveDriveTitlesForClub");
    expect(vaultPageSource).toContain("StoragePurchaseDialog");
    expect(vaultPageSource).toContain("useVaultExport({");
    expect(vaultPageSource).toContain("useVaultLargeFiles(");
    expect(vaultPageSource).toContain("useVaultTrashWorkflow({");
    expect(vaultPageSource).toContain("useVaultLightbox(");
    expect(vaultPageSource).toContain("useVaultBulkDeleteWorkflow(");
  });
});
