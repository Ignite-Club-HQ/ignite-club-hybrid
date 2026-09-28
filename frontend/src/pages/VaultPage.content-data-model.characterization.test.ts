import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const readIfExists = (relativePath: string) => {
  const path = join(pagesDirectory, relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};
const contentDataModelHookSource = readIfExists("../features/vault/useVaultContentDataModel.ts");
const readRepositorySource = readIfExists("../features/vault/vaultReadRepository.ts");
const scopeSource = readIfExists("../features/vault/vaultScope.ts");
const queryKeysSource = readIfExists("../features/vault/vaultQueryKeys.ts");
const classificationSource = readIfExists("../features/vault/vaultItemClassification.ts");
const clusterSource = [
  vaultPageSource,
  contentDataModelHookSource,
  readRepositorySource,
  scopeSource,
  queryKeysSource,
  classificationSource,
].join("\n");

describe("VaultPage content/folder/item/search data-model contract", () => {
  it("fails closed for a club root without an eligible role and skips folders entirely for mini-leagues", () => {
    expect(clusterSource).toMatch(
      /if\s*\(\s*view\.type === "root" \|\| view\.type === "mini-league"\s*\)\s*return \[\];/,
    );
    expect(clusterSource).toMatch(
      /view\.type === "club" &&\s*\n?\s*!options\.isClubAdmin &&\s*\n?\s*!options\.isCoachOrTeamAdmin &&\s*\n?\s*options\.clubRoles\.size === 0/,
    );
  });

  it("scopes subfolders to the exact club (null team) or exact team, honoring the resolved parent folder", () => {
    expect(clusterSource).toContain('query.eq("club_id", view.clubId).is("team_id", null)');
    expect(clusterSource).toMatch(/query\.eq\("parent_id", scope\.folderId\)\s*\n?\s*:\s*query\.is\("parent_id", null\)/);
  });

  it("filters restricted-role folders to privileged viewers or a qualifying club role", () => {
    expect(clusterSource).toContain("if (!folder.restricted_roles?.length) return true;");
    expect(clusterSource).toContain("if (options.isPrivilegedViewer) return true;");
    expect(clusterSource).toContain("folder.restricted_roles.some((role) => options.clubRoles.has(role));");
  });

  it("restricts a non-admin coach/team-admin club root to generic chat folders plus any folder they qualify for", () => {
    expect(clusterSource).toContain("GENERIC_CHAT_FOLDER_NAMES");
    expect(clusterSource).toMatch(/restrictClubRootToChatFolders:\s*\n?\s*view\.type === "club" && !options\.isClubAdmin && options\.isCoachOrTeamAdmin/);
    expect(clusterSource).toMatch(
      /GENERIC_CHAT_FOLDER_NAMES\.includes\([\s\S]{0,80}\) \|\| Boolean\(folder\.restricted_roles\?\.length\)/,
    );
  });

  it("fails closed on club files for a non-admin/non-coach and hides loose club-root files from a coach", () => {
    expect(clusterSource).toContain("if (!options.isClubAdmin && !options.isCoachOrTeamAdmin) return [];");
    expect(clusterSource).toMatch(
      /if \(!options\.isClubAdmin && options\.isCoachOrTeamAdmin && !scope\.folderId\) return \[\];/,
    );
  });

  it("scopes vault_files by exact team or exact mini-league, and by the resolved folder id (or root null)", () => {
    expect(clusterSource).toContain('query.eq("team_id", view.teamId);');
    expect(clusterSource).toContain('query.eq("mini_league_id", view.miniLeagueId);');
    expect(clusterSource).toMatch(
      /query\.eq\("folder_id", scope\.folderId\)\s*\n?\s*:\s*query\.is\("folder_id", null\)/,
    );
  });

  it("classifies photos vs files with the single shared classifier and maps compatibility fields without mutating rows", () => {
    expect(clusterSource).toContain("isVaultImageItem");
    expect(clusterSource).toContain("image_url: item.file_url");
    expect(clusterSource).toContain("uploader_id: item.uploaded_by");
    expect(clusterSource).toContain("title: item.name");
  });

  it("builds the recursive folder tree by a stack-based traversal from the selected start folder, filtering restricted roles the same way", () => {
    expect(clusterSource).toContain("const stack: Array<{ id: string | null; path: string }> = [");
    expect(clusterSource).toContain("{ id: startFolderId, path: \"\" }");
    expect(clusterSource).toMatch(/descendantIds:\s*descendants\.map\(\(folder\) => folder\.id\)/);
  });

  it("only builds a folder tree for club or team scopes, scoping club trees to null-team folders", () => {
    expect(clusterSource).toMatch(/if \(options\.view\.type !== "club" && options\.view\.type !== "team"\) return empty\(\);/);
    expect(clusterSource).toContain('query.eq("club_id", options.view.clubId).is("team_id", null)');
  });

  it("escapes ilike wildcard characters and bounds the recursive file search", () => {
    expect(clusterSource).toContain('normalized.replace(/[\\\\%_]/g, (character) => `\\\\${character}`)');
    expect(clusterSource).toContain('.limit(200)');
    expect(clusterSource).toMatch(/order\("created_at", \{ ascending: false \}\)/);
  });

  it("keeps root-level files (no folder_id) and every visible descendant, while excluding hidden-folder rows", () => {
    expect(clusterSource).toMatch(
      /!file\.folder_id \|\|\s*\n?\s*visibleFolderIds\.has\(file\.folder_id\) \|\|\s*\n?\s*file\.folder_id === scope\.folderId/,
    );
  });

  it("keeps the recursive search enabled only for a non-empty debounced query outside root and trash, and only once the folder tree resolves", () => {
    expect(clusterSource).toMatch(
      /debouncedVaultSearchQuery\.trim\(\)\.length > 0 && currentView\.type !== "root" && !showTrash/,
    );
    expect(contentDataModelHookSource).toContain("enabled: recursiveEnabled && !!folderTree");
  });

  it("keeps every content-cluster query key including the exact isAppAdmin/role-signature dimensions used by the page before extraction", () => {
    expect(contentDataModelHookSource).toContain("vaultKeys.subfoldersForView(");
    expect(contentDataModelHookSource).toContain("vaultKeys.filesForView(currentView, isClubAdmin, isCoachOrTeamAdmin)");
    expect(contentDataModelHookSource).toContain("vaultKeys.folderTree(");
    expect(contentDataModelHookSource).toContain("vaultKeys.recursiveSearch(");
    expect(queryKeysSource).toMatch(/isAppAdmin: boolean \| undefined/);
  });

  it("splits recursive photo/file matches with the same shared classifier as the active view, not a second duplicated regex", () => {
    expect(contentDataModelHookSource).toContain("(recursiveResult?.files || []).filter(isVaultImageItem)");
    expect(contentDataModelHookSource).toContain('(recursiveResult?.files || []).filter((f) => !isVaultImageItem(f))');
  });

  it("fuzzy-filters the active (non-recursive) or recursive folders/photos/files by name/title before rendering", () => {
    expect(contentDataModelHookSource).toContain("fuzzyFilter(searchSourceFolders, normalizedSearch");
    expect(contentDataModelHookSource).toContain("fuzzyFilter(searchSourcePhotos, normalizedSearch");
    expect(contentDataModelHookSource).toContain("fuzzyFilter(searchSourceFiles, normalizedSearch");
  });

  it("keeps currentView and showTrash page-owned, passed into the hook as read-only inputs", () => {
    expect(vaultPageSource).toContain(
      'const [currentView, setCurrentView] = useState<FolderView>({ type: "root" })',
    );
    expect(vaultPageSource).toContain("const [showTrash, setShowTrash] = useState(false);");
    expect(contentDataModelHookSource).not.toMatch(/useState<FolderView>/);
    expect(contentDataModelHookSource).not.toContain("useState(false)");
    expect(vaultPageSource).toMatch(/useVaultContentDataModel\(\{\s*\n\s*currentView,\s*\n\s*showTrash,/);
  });

  it("keeps the trash workflow, storage, upload/Drive/export/bulk-delete/folder-management, and dialogs page-owned and unaffected", () => {
    expect(vaultPageSource).toContain("useVaultTrashWorkflow({");
    expect(vaultPageSource).toContain("useVaultUploadWorkflow({");
    expect(vaultPageSource).toContain("useVaultDriveLinkWorkflow({");
    expect(vaultPageSource).toContain("useVaultExport({");
    expect(vaultPageSource).toContain("useVaultBulkDeleteWorkflow({");
    expect(vaultPageSource).toContain("useVaultFolderManagement({");
    expect(vaultPageSource).toContain("useVaultLargeFiles({");
    expect(vaultPageSource).toContain("fetchVaultStorageBreakdown");
  });
});
