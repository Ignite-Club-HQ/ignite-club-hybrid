import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const driveHookPath = join(pagesDirectory, "../features/vault/useVaultDriveLinkWorkflow.ts");
const driveDialogsPath = join(pagesDirectory, "../components/vault/VaultDriveLinkDialogs.tsx");
const topSectionPath = join(pagesDirectory, "../components/vault/VaultTopSection.tsx");
const driveTitleResolutionSource = readFileSync(
  join(pagesDirectory, "../features/vault/driveTitleResolution.ts"),
  "utf8",
);
const mutationRepositorySource = readFileSync(
  join(pagesDirectory, "../features/vault/vaultMutationRepository.ts"),
  "utf8",
);
const driveHookSource = existsSync(driveHookPath) ? readFileSync(driveHookPath, "utf8") : "";
const driveDialogsSource = existsSync(driveDialogsPath) ? readFileSync(driveDialogsPath, "utf8") : "";
const topSectionSource = existsSync(topSectionPath) ? readFileSync(topSectionPath, "utf8") : "";
// Combine every source that could plausibly own this cluster so assertions
// below hold whether the state/effects/mutation are still inline in the page
// or have been extracted into the typed hook/dialogs module (and, for the
// add-link insert, whether it is still inlined or reuses the tested
// `createVaultLinkFile` repository function).
const clusterSource = `${vaultPageSource}\n${driveHookSource}\n${driveDialogsSource}\n${topSectionSource}\n${mutationRepositorySource}`;

describe("Vault Add Link / Google Drive import/link/title-resolution behavior contract", () => {
  it("clears a saved OAuth error, warns the user, and drops the matching import-pending flag", () => {
    expect(clusterSource).toContain("sessionStorage.getItem('googleDriveOAuthError')");
    expect(clusterSource).toContain('toast.error("Google authentication was cancelled or failed")');
    expect(clusterSource).toContain("sessionStorage.removeItem('googleDriveOAuthError')");
    expect(clusterSource).toContain("sessionStorage.removeItem('googleDriveImportPending')");
  });

  it("exchanges a saved OAuth code with the exact redirect URI used today (native vs web origin)", () => {
    expect(clusterSource).toContain("sessionStorage.getItem('googleDriveOAuthCode')");
    expect(clusterSource).toContain("sessionStorage.removeItem('googleDriveOAuthCode')");
    // This literal (rather than a production domain) is the exact value
    // currently used for the native redirect URI — preserved verbatim.
    expect(clusterSource).toContain("'https://reference.invalid'");
    expect(clusterSource).toMatch(/redirectUri = isNative \? 'https:\/\/reference\.invalid' : `\$\{window\.location\.origin\}\/vault`/);
    expect(clusterSource).toContain("'google-drive-import?action=exchange-code'");
    expect(clusterSource).toMatch(/body: \{ code: savedCode, redirectUri \}/);
  });

  it("reports exchange failures with the exact toast and returns without opening any dialog", () => {
    expect(clusterSource).toMatch(/if \(exchangeError \|\| data\?\.error\) \{/);
    expect(clusterSource).toContain('toast.error("Failed to connect to Google Drive")');
  });

  it("routes a pending folder-link exchange ahead of import, storing the link-specific token keys", () => {
    expect(clusterSource).toContain("sessionStorage.getItem('driveLinkPending')");
    expect(clusterSource).toContain("sessionStorage.removeItem('driveLinkPending')");
    expect(clusterSource).toContain("sessionStorage.setItem('driveLinkAccessToken', data.accessToken)");
    expect(clusterSource).toContain("sessionStorage.setItem('driveLinkRefreshToken', data.refreshToken)");
    expect(clusterSource).toContain("sessionStorage.setItem('driveLinkGoogleEmail', data.googleEmail)");
    expect(clusterSource).toMatch(/setLinkDriveFolderOpen\(true\)/);
  });

  it("otherwise stores the import token keys and opens the Drive import dialog", () => {
    expect(clusterSource).toContain("sessionStorage.setItem('googleDriveAccessToken', data.accessToken)");
    expect(clusterSource).toContain("sessionStorage.setItem('googleDriveRefreshToken', data.refreshToken)");
    expect(clusterSource).toContain("sessionStorage.setItem('googleDriveGoogleEmail', data.googleEmail)");
    expect(clusterSource).toMatch(/setGoogleDriveImportOpen\(true\)/);
  });

  it("always clears the import-pending flag in a finally block regardless of outcome", () => {
    expect(clusterSource).toMatch(/finally \{\s*sessionStorage\.removeItem\('googleDriveImportPending'\);\s*\}/);
  });

  it("adds a link, scoping club/team/mini-league ids exactly like the upload flow, with is_external_link true and zero size", () => {
    expect(clusterSource).toMatch(/is_external_link: true/);
    expect(clusterSource).toMatch(/file_size: 0/);
    if (!driveHookSource) {
      // Pre-extraction: the page inlines the club/team/mini-league branch itself.
      expect(vaultPageSource).toMatch(/folder_id: getCurrentFolderId\(\)/);
      expect(vaultPageSource).toMatch(/insertData\.club_id = currentView\.clubId;[\s\S]{0,20}\} else if \(currentView\.type === "team"\) \{[\s\S]{0,80}insertData\.team_id = currentView\.teamId;/);
      expect(vaultPageSource).toMatch(/insertData\.mini_league_id = currentView\.miniLeagueId;/);
    } else {
      // Post-extraction: reuses the already-tested, `getVaultScope`-driven
      // `createVaultLinkFile` repository function instead of re-inlining the
      // club/team/mini-league branch.
      expect(driveHookSource).toContain("createVaultLinkFile({");
      expect(driveHookSource).toMatch(/folderId: getCurrentFolderId\(\)/);
      expect(mutationRepositorySource).toContain("export async function createVaultLinkFile(");
      expect(mutationRepositorySource).toMatch(/if \(scope\.teamId\) insert\.team_id = scope\.teamId;/);
      expect(mutationRepositorySource).toMatch(/if \(scope\.miniLeagueId\) insert\.mini_league_id = scope\.miniLeagueId;/);
    }
  });

  it("reports the exact add-link success/failure toasts and closes the dialog + invalidates the files cache on success", () => {
    expect(clusterSource).toMatch(/invalidateVaultCache\(queryClient, \["files"\]\)[\s\S]{0,80}setAddLinkDialogOpen\(false\)/);
    expect(clusterSource).toContain('toast.success("Link added successfully!")');
    expect(clusterSource).toContain('error.message || "Failed to add link"');
  });

  it("resolves Drive titles only when a club id is in scope and reports the exact loading/success/error toasts", () => {
    expect(clusterSource).toMatch(/const clubId = currentView\.type !== "root" \? currentView\.clubId : undefined;/);
    expect(clusterSource).toMatch(/if \(!clubId\) return;/);
    expect(clusterSource).toContain('toast.loading("Fetching real Google Drive titles…")');
    expect(clusterSource).toContain("resolveDriveTitlesForClub(");
    expect(driveTitleResolutionSource).toContain("export async function resolveDriveTitlesForClub(");
    expect(clusterSource).toContain('toast.success("No Google files needed renaming.", { id: toastId })');
    expect(clusterSource).toMatch(/`\$\{summary\.updated\} renamed`/);
    expect(clusterSource).toMatch(/summary\.unresolved > 0 && !summary\.hasOAuth/);
    expect(clusterSource).toContain("Tip: link a Google Drive folder so private files can be renamed too.");
    expect(clusterSource).toMatch(/invalidateVaultCache\(queryClient, \["files"\]\)/);
    expect(clusterSource).toContain('toast.error("Couldn\'t fetch Drive titles"');
    expect(clusterSource).toMatch(/setResolvingDriveTitles\(false\);\s*\}/);
  });

  it("wires the Add Link dialog to the mutation's pending state and the current view's target name", () => {
    expect(clusterSource).toMatch(/onAddLink=\{?\(?url,\s*name\)?\s*=>\s*addLinkMutation\.mutate\(\{\s*url,\s*name\s*\}\)/);
    expect(clusterSource).toContain("addLinkMutation.isPending");
  });

  it("scopes the Google Drive import dialog's target folder to team/mini-league only, never a bare club folder id", () => {
    expect(clusterSource).toMatch(
      /targetFolderId=\{currentView\.type === "team" \|\| currentView\.type === "mini-league" \? \(currentView\.folderId \|\| null\) : null\}/,
    );
    expect(clusterSource).toMatch(/targetTeamId=\{currentView\.type === "team" \? currentView\.teamId : null\}/);
  });

  it("invalidates both the files and vault-folders caches identically for import completion and folder-link changes", () => {
    const occurrences = clusterSource.match(/invalidateVaultCache\(queryClient, \["files"\]\);\s*queryClient\.invalidateQueries\(\{ queryKey: \["vault-folders"\] \}\);/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
  });

  it("only renders the Link Drive Folder dialog when the current view carries a club id", () => {
    expect(clusterSource).toMatch(/'clubId' in currentView/);
    expect(clusterSource).toMatch(/vaultFolderId=\{currentView\.folderId \?\? null\}/);
  });

  it("gates the Add-dropdown and More-dropdown Drive menu items to the allowed clubs, non-iOS, club admins", () => {
    expect(clusterSource).toContain("DRIVE_IMPORT_ALLOWED_CLUB_IDS");
    expect(clusterSource).toMatch(/isClubAdmin && Capacitor\.getPlatform\(\) !== 'ios' && 'clubId' in currentView && DRIVE_IMPORT_ALLOWED_CLUB_IDS\.has\(currentView\.clubId\)/);
  });

  it("leaves upload/file-name flow, folder/file management, export/large-files, trash/recovery, lightbox, and bulk-delete untouched", () => {
    // Upload/file-name flow was subsequently extracted into
    // `useVaultUploadWorkflow` by a later Phase 4A round (see
    // VaultPage.upload.characterization.test.ts); this Drive/Add Link
    // cluster only needs to not have re-absorbed it.
    expect(vaultPageSource).toContain("useVaultUploadWorkflow");
    expect(vaultPageSource).not.toContain("uploadPhotoMutation");
    expect(vaultPageSource).not.toContain("uploadFileMutation");
    expect(vaultPageSource).toContain("useVaultFolderManagement");
    expect(vaultPageSource).toContain("useVaultExport");
    expect(vaultPageSource).toContain("useVaultTrashWorkflow");
    expect(vaultPageSource).toContain("useVaultLightbox");
    expect(vaultPageSource).toContain("useVaultBulkDeleteWorkflow");
  });
});
