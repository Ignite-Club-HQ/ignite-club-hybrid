import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const mainContentPath = join(pagesDirectory, "../components/vault/VaultMainContent.tsx");
const mainContentSource = existsSync(mainContentPath) ? readFileSync(mainContentPath, "utf8") : "";
const clusterSource = `${vaultPageSource}\n${mainContentSource}`;

describe("VaultPage navigation and search presentation contract", () => {
  it("keeps the search bar visible only inside a non-root, non-trash view", () => {
    expect(clusterSource).toMatch(/currentView\.type !== "root" && !showTrash/);
    expect(clusterSource).toContain('placeholder="Search folders and files..."');
    expect(clusterSource).toContain("aria-busy={isFetchingRecursive}");
    expect(clusterSource).toContain('aria-label="Clear search"');
    expect(clusterSource).toMatch(
      /isFetchingRecursive \? "ring-2 ring-primary\/40 ring-offset-0 animate-pulse" : ""/,
    );
    expect(clusterSource).toMatch(/onChange=\{\(e\) => (?:setVaultSearchQuery|onQueryChange)\(e\.target\.value\)\}/);
    expect(clusterSource).toMatch(/onClick=\{\(\) => (?:setVaultSearchQuery|onQueryChange)\(""\)\}/);
  });

  it("keeps the polite search status with its searching, empty, and match copy", () => {
    expect(clusterSource).toContain('role="status"');
    expect(clusterSource).toContain('aria-live="polite"');
    expect(clusterSource).toMatch(/\{(?:vaultSearchQuery|query)\.trim\(\) && \(/);
    expect(clusterSource).toContain("Searching all nested folders…");
    expect(clusterSource).toMatch(/No matches for "\{(?:vaultSearchQuery|query)\}"/);
    expect(clusterSource).toMatch(
      /const total = (?:displaySubfolders\.length \+ displayPhotos\.length \+ displayFiles\.length|folderMatchCount \+ photoMatchCount \+ fileMatchCount);/,
    );
    expect(clusterSource).toContain('if (total === 0)');
    expect(clusterSource).toMatch(/\{total\} \{total === 1 \? "match" : "matches"\} across all subfolders/);
  });

  it("keeps the root club picker loading, empty, and club-filter behavior", () => {
    expect(clusterSource).toMatch(/currentView\.type === "root" &&\s*(?:\(|<)/);
    expect(clusterSource).toMatch(/\{(?:isLoadingClubs)/);
    expect(clusterSource).toContain("Loading clubs...");
    expect(clusterSource).toMatch(/!(?:userClubs|clubs) \|\| (?:userClubs|clubs)\.length === 0/);
    expect(clusterSource).toContain("No clubs found");
    expect(clusterSource).toMatch(
      /activeClubFilter \? (?:userClubs|clubs)\.filter\(c => c\.id === activeClubFilter\) : (?:userClubs|clubs)/,
    );
  });

  it("keeps the Pro lock copy, icons, and upgrade navigation for root clubs", () => {
    expect(clusterSource).toMatch(/const isPro = club\.is_pro;/);
    expect(clusterSource).toContain("Pro feature — Upgrade to unlock vault");
    expect(clusterSource).toMatch(/!isPro \? \(\s*<Lock className="h-4 w-4 text-muted-foreground" \/>/);
    expect(clusterSource).toContain('<ChevronRight className="h-4 w-4 text-muted-foreground" />');
    expect(vaultPageSource).toMatch(/if \(!club\.is_pro\) \{\s*navigate\(`\/clubs\/\$\{club\.id\}\/upgrade`\);\s*return;\s*\}/);
    expect(vaultPageSource).toMatch(/setCurrentView\(\{ type: "club", clubId: club\.id, clubName: club\.name \}\)/);
  });

  it("keeps club team folders grouped, colored, and gated to the club root", () => {
    expect(clusterSource).toMatch(
      /!showTrash && !currentView\.folderId && (?:clubTeams|teams) && (?:clubTeams|teams)\.length > 0/,
    );
    expect(clusterSource).toContain(">Teams</h2>");
    expect(clusterSource).toMatch(/(?:teamFolders) && (?:teamFolders)\.length > 0 && (?:teamFolders)\.map\(\(folder\) => \{/);
    expect(clusterSource).toMatch(/\.filter\(team => team\.folder_id === folder\.id\)/);
    expect(clusterSource).toContain("if (teamsInFolder.length === 0) return null;");
    expect(clusterSource).toContain("const colorInfo = getFolderColorClass(folder.color);");
    expect(clusterSource).toMatch(/rounded-lg \$\{colorInfo\.bgClassName\}/);
    expect(clusterSource).toMatch(/h-4 w-4 \$\{colorInfo\.className\}/);
    expect(clusterSource).toContain("({teamsInFolder.length})");
  });

  it("keeps uncategorized teams with their conditional Other Teams header", () => {
    expect(clusterSource).toMatch(/\.filter\(team => !team\.folder_id\)/);
    expect(clusterSource).toContain("if (uncategorizedTeams.length === 0) return null;");
    expect(clusterSource).toMatch(
      /const hasTeamFolders = teamFolders && teamFolders\.some\(folder =>\s*(?:clubTeams|teams)\.some\(team => team\.folder_id === folder\.id\)\s*\);/,
    );
    expect(clusterSource).toContain("Other Teams");
    expect(clusterSource).toContain("({uncategorizedTeams.length})");
    expect(clusterSource).toContain('hasTeamFolders ? "pl-2 space-y-2" : "space-y-2"');
  });

  it("keeps mini-league cards gated to the club root and outside trash", () => {
    expect(clusterSource).toMatch(
      /!showTrash && !currentView\.folderId && (?:clubMiniLeagues|miniLeagues) && (?:clubMiniLeagues|miniLeagues)\.length > 0/,
    );
    expect(clusterSource).toContain(">Mini-Leagues</h2>");
    expect(clusterSource).toMatch(/(?:clubMiniLeagues|miniLeagues)\.map\(\(league\) => \(/);
    expect(clusterSource).toContain('<div className="p-2 rounded-lg bg-accent">');
    expect(clusterSource).toContain('<FolderOpen className="h-4 w-4 text-accent-foreground" />');
  });

  it("keeps team and mini-league navigation targets owned by the page", () => {
    expect(vaultPageSource).toMatch(
      /type: "team",\s*clubId: currentView\.clubId,\s*clubName: currentView\.clubName,\s*teamId: team\.id,\s*teamName: team\.name/,
    );
    expect(vaultPageSource).toMatch(
      /type: "mini-league",\s*clubId: currentView\.clubId,\s*clubName: currentView\.clubName,\s*miniLeagueId: league\.id,\s*miniLeagueName: league\.name/,
    );
    expect(vaultPageSource.match(/setFolderPath\(\[\]\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("keeps the club, team, and mini-league content renderer branches", () => {
    for (const branch of ["club", "team", "mini-league"]) {
      expect(clusterSource).toContain(`currentView.type === "${branch}"`);
    }
    expect(clusterSource.match(/<VaultContentRenderer/g)?.length).toBe(3);
    expect(clusterSource.match(/\{\.\.\.contentRendererView\}/g)?.length).toBe(2);
    expect(clusterSource).toMatch(/folders=\{(?:displaySubfolders|folders) \|\| \[\]\}/);
    expect(clusterSource).toMatch(/searchQuery=\{(?:normalizedSearch|searchQuery)\}/);
    expect(clusterSource).toMatch(/onNavigateToFolder=\{\(folder\) => (?:navigateToFolder|onNavigateToFolder)\(folder\)\}/);
    expect(clusterSource).toMatch(/onShareFolder=\{\(folder\) => (?:shareFolder\(folder\.id\)|onShareFolder\(folder\))\}/);
    expect(clusterSource).toMatch(/onExportFolder=\{\(folder\) => (?:openFolderExportDialog|onExportFolder)\(folder\)\}/);
    expect(clusterSource).toMatch(/onRenameFolder=\{(?:startRenameFolder|onRenameFolder)\}/);
    expect(clusterSource).toMatch(/onDeleteFolder=\{(?:requestDeleteFolder|onDeleteFolder)\}/);
    expect(clusterSource).toMatch(/canEditFolder=\{(?:canDeleteFolder|canEditFolder)\}/);
  });

  it("keeps the mini-league renderer restricted to read-only photo content", () => {
    expect(clusterSource).toContain("folders={[]}");
    expect(clusterSource).toContain("onNavigateToFolder={() => undefined}");
    expect(clusterSource).toContain("canEditFolder={() => false}");
    expect(clusterSource).toMatch(/mode="content"\s*\n\s*content=\{(?:miniLeagueContentRendererProps|miniLeagueContent)\}/);
    expect(vaultPageSource).toMatch(
      /const miniLeagueContentRendererProps: ContentSectionProps = \{\s*\.\.\.contentRendererProps,\s*files: \[\],/,
    );
    expect(vaultPageSource).toContain("canDeleteFile: () => false,");
    expect(vaultPageSource).toContain("canRenameFile: () => false,");
    expect(vaultPageSource).toContain("onMoveFile: undefined,");
  });

  it("keeps renderer data models, queries, workflows, and dialogs page-owned", () => {
    for (const model of [
      "const contentRendererProps: ContentSectionProps",
      "const trashRendererProps: TrashSectionProps",
      "const contentRendererView = showTrash",
      '{ mode: "trash" as const, trash: trashRendererProps }',
      '{ mode: "content" as const, content: contentRendererProps }',
    ]) {
      expect(vaultPageSource).toContain(model);
    }
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
      expect(mainContentSource).not.toContain(`${hook}(`);
    }
    expect(vaultPageSource).toContain(
      'const [currentView, setCurrentView] = useState<FolderView>({ type: "root" })',
    );
    expect(vaultPageSource).toContain("const { activeClubFilter } = useClubTheme();");
    expect(mainContentSource).not.toContain("useQuery(");
    expect(mainContentSource).not.toContain("useClubTheme");
    expect(mainContentSource).not.toContain("@/integrations/supabase/client");
    expect(vaultPageSource).toContain("<VaultLightbox");
    expect(vaultPageSource).toContain("<VaultFolderManagementDialogs");
  });

  it("retains the existing static import boundaries for navigation presentation", () => {
    expect(vaultPageSource).toContain(
      'import { VaultContentRenderer, type ContentSectionProps, type TrashSectionProps } from "@/components/vault/VaultContentRenderer"',
    );
    expect(vaultPageSource).not.toMatch(
      /lazyWithRetry\(\(\) => import\("@\/components\/vault\/(?:VaultMainContent|VaultContentRenderer)"\)/,
    );
    expect(vaultPageSource).toContain(
      'lazyWithRetry(() => import("@/components/vault/UploadFilesDialog")',
    );
  });
});
