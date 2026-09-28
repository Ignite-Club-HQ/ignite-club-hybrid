import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const rendererSource = existsSync(join(pagesDirectory, "../components/vault/VaultContentRenderer.tsx"))
  ? readFileSync(join(pagesDirectory, "../components/vault/VaultContentRenderer.tsx"), "utf8")
  : "";
const contentSectionSource = existsSync(join(pagesDirectory, "../components/vault/VaultContentSection.tsx"))
  ? readFileSync(join(pagesDirectory, "../components/vault/VaultContentSection.tsx"), "utf8")
  : "";
const trashSectionSource = existsSync(join(pagesDirectory, "../components/vault/VaultTrashSection.tsx"))
  ? readFileSync(join(pagesDirectory, "../components/vault/VaultTrashSection.tsx"), "utf8")
  : "";
const topSectionSource = existsSync(join(pagesDirectory, "../components/vault/VaultTopSection.tsx"))
  ? readFileSync(join(pagesDirectory, "../components/vault/VaultTopSection.tsx"), "utf8")
  : "";
const trashWorkflowSource = existsSync(join(pagesDirectory, "../features/vault/useVaultTrashWorkflow.ts"))
  ? readFileSync(join(pagesDirectory, "../features/vault/useVaultTrashWorkflow.ts"), "utf8")
  : "";
const trashRepositorySource = existsSync(join(pagesDirectory, "../features/vault/vaultTrashRepository.ts"))
  ? readFileSync(join(pagesDirectory, "../features/vault/vaultTrashRepository.ts"), "utf8")
  : "";
const vaultReadRepositorySource = existsSync(join(pagesDirectory, "../features/vault/vaultReadRepository.ts"))
  ? readFileSync(join(pagesDirectory, "../features/vault/vaultReadRepository.ts"), "utf8")
  : "";
const uploadWorkflowSource = existsSync(join(pagesDirectory, "../features/vault/useVaultUploadWorkflow.ts"))
  ? readFileSync(join(pagesDirectory, "../features/vault/useVaultUploadWorkflow.ts"), "utf8")
  : "";
const source = `${vaultPageSource}\n${rendererSource}\n${contentSectionSource}\n${trashSectionSource}\n${topSectionSource}\n${trashWorkflowSource}\n${trashRepositorySource}\n${vaultReadRepositorySource}\n${uploadWorkflowSource}`;

describe("VaultPage rendering and provider-boundary characterization", () => {
  it("keeps club, team, and mini-league scope branches distinct", () => {
    expect(vaultPageSource).toContain('currentView.type === "club"');
    expect(vaultPageSource).toContain('currentView.type === "team"');
    expect(vaultPageSource).toContain('currentView.type === "mini-league"');
    expect(source).toContain("files: [],");
    expect(source).toContain("canDeleteFile: () => false");
    expect(source).toContain("onRenameFile: () => undefined");
  });

  it("keeps the shared active-content and trash variants observable", () => {
    expect(source).toContain("ContentSection");
    expect(source).toContain("TrashSection");
    expect(source).toContain("photos.map");
    expect(source).toContain("files.map");
    expect(source).toContain("isTrashView ? \"Trash is empty\"");
    expect(source).toContain('if (isLoading)');
    expect(source).toContain("Loading trash...");
    expect(source).toContain("Deleted Photos ({photos.length})");
    expect(source).toContain("Deleted Files ({files.length})");
  });

  it("preserves row actions, confirmation callbacks, and cache scopes", () => {
    expect(source).toContain('aria-label="File actions"');
    expect(source).toContain('label="Move to Folder"');
    expect(source).toContain('label="Rename"');
    expect(source).toContain('label="Delete" destructive');
    expect(vaultPageSource).toContain('showTrash ? permanentDeletePhotoMutation.mutate');
    expect(vaultPageSource).toContain('showTrash ? permanentDeleteFileMutation.mutate');
    expect(source).toContain('invalidateVaultCache(queryClient, ["trash", "files"]);');
    // Upload's cache-invalidation scope moved into `useVaultUploadWorkflow`
    // in the upload/file-name Phase 4A round; this cluster only needs it to
    // still exist somewhere in the Vault package, matching this test's own
    // combined-source approach for the other extracted Vault workflow hooks.
    expect(source).toContain('invalidateVaultCache(queryClient, ["files", "clubs", "storageBreakdown"]);');
    expect(source).toContain('invalidateVaultCache(queryClient, ["trash", "files", "storageBreakdown", "photos"]);');
  });

  it("preserves storage projection and the provider-specific page boundary", () => {
    expect(vaultPageSource).toContain("currentTeamStorageUsed");
    expect(source).toContain("byTeam.slice(0, 5)");
    expect(source).toContain("VaultStorageTeamProjection");
    expect(source).toContain("VaultStorageBreakdown");
    expect(vaultPageSource).toContain("function SupabaseVaultPage");
    expect(vaultPageSource).toContain("resolveLocalAuthMode");
    expect(vaultPageSource).toContain("IcpUnavailablePage");
    expect(vaultPageSource).not.toContain("SupabaseVaultPage = Icp");
  });

  it("keeps the trash workflow scoped, ordered, authorized, and failure-visible", () => {
    expect(source).toMatch(/queryKey: (?:\["vault-trash"|vaultKeys\.trashForClub)/);
    expect(source).toContain('enabled: showTrash && currentView.type !== "root"');
    expect(source).toContain('order("deleted_at", { ascending: false })');
    expect(source).toContain("isVaultImage");
    expect(source).toContain("onPermanentDeletePhoto: isClubAdmin ? setDeletePhotoId : undefined");
    expect(source).toContain("onPermanentDeleteFile: isClubAdmin ? setDeleteFileId : undefined");
    expect(source).toContain("onEmptyTrash: isClubAdmin ? emptyTrash : undefined");
    expect(source).toContain('invalidateVaultCache(queryClient, ["trash", "files"]);');
    expect(source).toContain('invalidateVaultCache(queryClient, ["trash", "files", "storageBreakdown", "photos"]);');
    expect(source).toContain("resolveEmptyTrashOutcome");
    expect(source).toContain("Failed to empty trash");
  });
});
