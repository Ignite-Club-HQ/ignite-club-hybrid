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
const accessModelHookSource = readIfExists("../features/vault/useVaultAccessModel.ts");
const accessRepositorySource = readIfExists("../features/vault/vaultAccessRepository.ts");
const accessLogicSource = readIfExists("../features/vault/vaultAccess.ts");
const queryKeysSource = readIfExists("../features/vault/vaultQueryKeys.ts");
const clusterSource = [
  vaultPageSource,
  accessModelHookSource,
  accessRepositorySource,
  accessLogicSource,
  queryKeysSource,
].join("\n");

describe("VaultPage access/entitlement/root-navigation data-model contract", () => {
  it("keeps the app-admin and user-roles queries scoped to the exact user", () => {
    expect(clusterSource).toContain('["is-app-admin"');
    expect(clusterSource).toContain('["user-admin-roles"');
    expect(clusterSource).toContain(`.eq("role", "app_admin")`);
    expect(clusterSource).toMatch(/enabled:\s*!!user(Id)?\b/);
  });

  it("keeps the role-access decision delegated to the shared Vault access rule", () => {
    expect(clusterSource).toMatch(/\w*VaultRoleAccess\(isAppAdmin \?\? false, userRoles\)/);
  });

  it("keeps the eligible-clubs query branching on app-admin and scoping to the exact user id", () => {
    expect(clusterSource).toContain('"vault-clubs"');
    expect(clusterSource).toMatch(/isAppAdmin\s*!==\s*undefined/);
  });

  it("keeps the root auto-navigation once-only, Pro-gated, and scoped to the theme filter's club", () => {
    expect(clusterSource).toContain("hasAutoNavigatedRef");
    expect(clusterSource).toMatch(/activeClubFilter\s*&&[\s\S]{0,60}currentView\.type === "root"/);
    expect(clusterSource).toMatch(/userClubs\s*&&\s*userClubs\.length > 0\s*&&\s*!hasAutoNavigatedRef\.current/);
    expect(clusterSource).toMatch(/club\.is_pro/);
    expect(clusterSource).toContain("hasAutoNavigatedRef.current = true");
    // The club/team/mini-league content queries (clubTeams, teamFolders,
    // subfolders, vaultItems, clubMiniLeagues) stay in the page and must
    // keep reading the resolved role/entitlement values, not re-derive them.
    expect(vaultPageSource).toContain("isClubAdmin, userTeamIds, currentClubHasPro");
  });

  it("keeps club-admin/committee and coach/team-admin visibility scoped to the active club", () => {
    expect(clusterSource).toMatch(/isVaultClubAdminOrCommittee\(isAppAdmin \?\? false, currentView, userRoles\)/);
    expect(clusterSource).toMatch(/isVaultCoachOrTeamAdmin\(isClubAdmin, currentView, userRoles\)/);
  });

  it("keeps the admin-upgrade route and accessible-team-id derivations sourced from user roles", () => {
    expect(clusterSource).toContain("getVaultAdminUpgradeInfo(userRoles)");
    expect(clusterSource).toContain("getVaultTeamIds(userRoles)");
  });

  it("keeps current-context Pro entitlement scoped per view type (club/team inherits club, mini-league is club-only)", () => {
    expect(clusterSource).toMatch(/queryKey:\s*(?:\["vault-club-has-pro"|vaultKeys\.clubHasPro)/);
    expect(clusterSource).toMatch(/queryKey:\s*(?:\["vault-team-has-pro"|vaultKeys\.teamHasPro)/);
    expect(clusterSource).toContain("club_subscriptions");
    expect(clusterSource).toContain("team_subscriptions");
    expect(clusterSource).toContain("admin_pro_override");
    expect(clusterSource).toContain("admin_pro_football_override");
  });

  it("keeps the root-view any-Pro entitlement check distinct from the scoped current-context check", () => {
    expect(clusterSource).toContain('"pro-access-info"');
    expect(clusterSource).toMatch(/hasProClub\s*=\s*proAccessInfo\s*\?\?\s*false/);
    expect(clusterSource).toMatch(/currentView\.type === "root" \? hasProClub : currentContextHasPro/);
  });

  it("keeps the access decision requiring both role access and the relevant Pro context, with app-admin bypassing Pro only", () => {
    expect(clusterSource).toMatch(/isAppAdmin:\s*isAppAdmin \?\? false/);
    expect(clusterSource).toMatch(/hasRoleAccess:\s*hasVaultRoleAccess/);
    expect(clusterSource).toMatch(/hasAnyPro:\s*hasProClub/);
    expect(clusterSource).toMatch(/isRoot:\s*currentView\.type === "root"/);
  });

  it("keeps the loading gate aggregating every constituent access query", () => {
    expect(vaultPageSource).toMatch(/if \(isLoadingAccess\) \{/);
    expect(vaultPageSource).toContain("animate-spin");
  });

  it("keeps the Pro-vs-role denial copy and the upgrade CTA link target", () => {
    expect(vaultPageSource).toContain("hasProButNoRole");
    expect(vaultPageSource).toContain("Permission Required");
    expect(vaultPageSource).toContain("Vault is a Pro Feature");
    expect(vaultPageSource).toContain("adminUpgradeInfo.clubId || adminUpgradeInfo.teamId");
    expect(vaultPageSource).toContain("`/teams/${adminUpgradeInfo.teamId}/upgrade`");
    expect(vaultPageSource).toContain("`/clubs/${adminUpgradeInfo.clubId}/upgrade`");
  });

  it("keeps currentView page-owned as state, not moved into the access-model hook", () => {
    expect(vaultPageSource).toContain(
      'const [currentView, setCurrentView] = useState<FolderView>({ type: "root" })',
    );
    expect(accessModelHookSource).not.toMatch(/useState<FolderView>/);
    expect(accessModelHookSource).not.toContain("setCurrentView(");
  });

  it("keeps storage-domain consumers (isStorageLimitReached, storage warning) reading hasProClub without duplicating the query", () => {
    expect(vaultPageSource).toContain("if (!hasProClub) return true");
    expect(vaultPageSource).toContain("isAppAdmin, hasProClub, totalClubStorageUsed");
  });
});
