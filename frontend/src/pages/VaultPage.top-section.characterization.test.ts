import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const topSectionPath = join(pagesDirectory, "../components/vault/VaultTopSection.tsx");
const topSectionSource = existsSync(topSectionPath) ? readFileSync(topSectionPath, "utf8") : "";
const clusterSource = `${vaultPageSource}\n${topSectionSource}`;

describe("VaultPage header, storage, and action-toolbar presentation contract", () => {
  it("keeps the root and inner headers with hierarchy navigation wired", () => {
    expect(clusterSource).toContain('currentView.type === "root"');
    expect(clusterSource).toContain('aria-label="Go back"');
    expect(clusterSource).toContain(">Vault</h1>");
    expect(clusterSource).toContain("Club file storage");
    expect(vaultPageSource).toContain("getHierarchyNodes()");
    expect(clusterSource).toContain('current?.label ?? "Vault"');
    expect(clusterSource).toContain("parents.map((node, i)");
    expect(clusterSource).toContain("onClick={node.onClick}");
    expect(vaultPageSource).toMatch(/(?:onClick=\{goBack\}|onInnerBack: goBack)/);
  });

  it("keeps compact storage usage and expanded breakdown calculations and labels", () => {
    expect(clusterSource).toMatch(
      /Math\.min\(100, Math\.max\(0, \(totalClubStorageUsed \/ PRO_STORAGE_LIMIT\) \* 100\)\)/,
    );
    expect(clusterSource).toContain(
      "`${formatStorageSize(totalClubStorageUsed)} / ${5 + (purchasedStorageGb || 0)} GB`",
    );
    expect(clusterSource).toContain("isStorageLimitReached={isStorageLimitReached}");
    expect(clusterSource).toContain("This Team");
    expect(clusterSource).toMatch(
      /Math\.round\(\(currentTeamStorageUsed \/ totalClubStorageUsed\) \* 100\)/,
    );
    expect(clusterSource).toContain("<VaultStorageBreakdown");
    expect(clusterSource).toContain("photos={storageBreakdown.photos}");
    expect(clusterSource).toContain("documents={storageBreakdown.documents}");
    expect(clusterSource).toContain("<VaultStorageTeamProjection");
    expect(clusterSource).toContain("byTeam={storageBreakdown?.byTeam || []}");
  });

  it("keeps selection, export, download, and delete actions with their enablement", () => {
    expect(clusterSource).toMatch(
      /(?:\(photos\?\.length > 0 \|\| files\?\.length > 0\)|\(photoCount > 0 \|\| fileCount > 0\)) && !showTrash && selectionMode/,
    );
    expect(clusterSource).toContain("onClick={selectAll}");
    expect(clusterSource).toContain("Select All");
    expect(clusterSource).toContain("onClick={exitSelectionMode}");
    expect(clusterSource).toContain("Exit selection mode");
    expect(clusterSource).toContain("selectedCount > 0");
    expect(clusterSource).toContain("onClick={() => initiateExport('zip')}");
    expect(clusterSource).toContain("Export ({selectedCount})");
    expect(clusterSource).toContain("onClick={() => initiateExport('download')}");
    expect(clusterSource).toContain("Download ({selectedCount})");
    expect(clusterSource).toMatch(
      /\(isClubAdmin \|\| isAppAdmin\) && \([\s\S]{0,500}setBulkDeleteDialogOpen\(true\)/,
    );
    expect(clusterSource).toContain("Delete ({selectedCount})");
    expect(clusterSource).toContain("disabled");
    expect(clusterSource).toContain("{exportProgress.current}/{exportProgress.total}");
    expect(clusterSource).toContain("onClick={cancelExport}");
  });

  it("keeps Upload, Add, and More menus under the existing gates", () => {
    expect(clusterSource).toMatch(/!selectionMode && !isExporting && \(/);
    expect(clusterSource).toMatch(/\{canUpload && \([\s\S]{0,350}setUploadDialogOpen\(true\)/);
    expect(clusterSource).toContain("Upload photos or files");
    expect(clusterSource).toContain("setNewFolderDialogOpen(true)");
    expect(clusterSource).toContain("New Folder");
    expect(clusterSource).toContain("setAddLinkDialogOpen(true)");
    expect(clusterSource).toContain("Add Link");
    expect(clusterSource).toContain("setSelectionMode(true)");
    expect(clusterSource).toContain("Export as ZIP");
    expect(clusterSource).toContain("ZIP All (with subfolders)");
    expect(clusterSource).toContain("setShowTrash(!showTrash)");
    expect(clusterSource).toContain("View Files");
    expect(clusterSource).toContain("View Trash");
    expect(clusterSource).toMatch(/!canUpload && !selectionMode && !isExporting/);
  });

  it("keeps Drive actions behind club allowlist, platform, and admin gates", () => {
    expect(clusterSource).toContain("DRIVE_IMPORT_ALLOWED_CLUB_IDS");
    expect(clusterSource).toMatch(
      /isClubAdmin && Capacitor\.getPlatform\(\) !== 'ios' && 'clubId' in currentView && DRIVE_IMPORT_ALLOWED_CLUB_IDS\.has\(currentView\.clubId\)/,
    );
    expect(clusterSource).toContain("setGoogleDriveImportOpen(true)");
    expect(clusterSource).toContain("Import from Drive");
    expect(clusterSource).toContain("setLinkDriveFolderOpen(true)");
    expect(clusterSource).toContain("Sync with Drive folder");
    expect(clusterSource).toContain("onClick={handleResolveDriveTitles}");
    expect(clusterSource).toContain("disabled={resolvingDriveTitles}");
    expect(clusterSource).toContain("Fetch real Google titles");
  });

  it("keeps storage warning, large-file action, and purchase CTA wiring", () => {
    expect(clusterSource).toMatch(
      /\(isClubAdmin \|\| \(totalClubStorageUsed \/ PRO_STORAGE_LIMIT\) >= 0\.8\)/,
    );
    expect(clusterSource).toMatch(
      /\(totalClubStorageUsed \/ PRO_STORAGE_LIMIT\) >= 0\.8[\s\S]{0,500}onClick=\{openLargeFiles\}/,
    );
    expect(clusterSource).toContain("Manage Large Files");
    expect(clusterSource).toContain("setStoragePurchaseDialogOpen(true)");
    expect(clusterSource).toContain(
      'purchasedStorageGb > 0 ? "Manage Storage" : "Buy Storage"',
    );
  });

  it("keeps workflow, query, current-view, and dialog ownership outside presentation", () => {
    for (const hook of [
      "useVaultTrashWorkflow",
      "useVaultExport",
      "useVaultLargeFiles",
      "useVaultLightbox",
      "useVaultBulkDeleteWorkflow",
      "useVaultFolderManagement",
      "useVaultDriveLinkWorkflow",
      "useVaultUploadWorkflow",
    ]) {
      expect(vaultPageSource).toContain(hook);
      expect(topSectionSource).not.toContain(`${hook}(`);
    }
    expect(vaultPageSource).toContain(
      'const [currentView, setCurrentView] = useState<FolderView>({ type: "root" })',
    );
    expect(topSectionSource).not.toContain("useQuery(");
    expect(vaultPageSource).toContain("<UploadFilesDialog");
    expect(vaultPageSource).toContain("<VaultDriveLinkDialogs");
  });

  it("retains the existing route and interaction-gated lazy boundaries", () => {
    expect(clusterSource).toMatch(
      /lazyWithRetry\(\(\) =>\s*import\("@\/components\/vault\/VaultStorageBreakdown"\)/,
    );
    expect(vaultPageSource).toContain(
      'lazyWithRetry(() => import("@/components/vault/UploadFilesDialog")',
    );
    expect(vaultPageSource).not.toMatch(/lazyWithRetry\(\(\) => import\("@\/components\/vault\/VaultTopSection"\)/);
  });
});
