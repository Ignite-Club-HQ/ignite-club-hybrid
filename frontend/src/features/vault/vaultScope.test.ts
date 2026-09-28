import { describe, expect, it } from "vitest";
import {
  abbreviateVaultOrganisationName,
  collectVaultClubRoles,
  filterVisibleVaultFolders,
  getVaultScope,
} from "./vaultScope";

describe("Vault scope rules", () => {
  it("returns an empty scope at the Vault root", () => {
    expect(getVaultScope({ type: "root" })).toEqual({
      clubId: null,
      teamId: null,
      miniLeagueId: null,
      folderId: null,
    });
  });

  it("keeps club and folder scope without inventing a team or league", () => {
    expect(getVaultScope({
      type: "club",
      clubId: "club-a",
      clubName: "Club A",
      folderId: "folder-a",
    })).toEqual({
      clubId: "club-a",
      teamId: null,
      miniLeagueId: null,
      folderId: "folder-a",
    });
  });

  it("keeps exact team and mini-league scopes mutually exclusive", () => {
    expect(getVaultScope({
      type: "team",
      clubId: "club-a",
      clubName: "Club A",
      teamId: "team-a",
      teamName: "Team A",
    })).toMatchObject({ teamId: "team-a", miniLeagueId: null });

    expect(getVaultScope({
      type: "mini-league",
      clubId: "club-a",
      clubName: "Club A",
      miniLeagueId: "league-a",
      miniLeagueName: "League A",
    })).toMatchObject({ teamId: null, miniLeagueId: "league-a" });
  });

  it("collects only roles belonging to the current club", () => {
    expect([...collectVaultClubRoles([
      { club_id: "club-a", role: "coach" },
      { club_id: "club-a", role: "team_admin" },
      { club_id: "club-b", role: "club_admin" },
      { club_id: "club-a", role: null },
    ], "club-a")]).toEqual(["coach", "team_admin"]);
  });

  it("fails closed when there is no active club or role list", () => {
    expect(collectVaultClubRoles(undefined, "club-a").size).toBe(0);
    expect(collectVaultClubRoles([{ club_id: "club-a", role: "coach" }], null).size).toBe(0);
  });

  const folders = [
    { id: "policies", name: "Policies", restricted_roles: null },
    { id: "images", name: "Chat Images", restricted_roles: null },
    { id: "coach", name: "Coaches Chat", restricted_roles: ["coach"] },
    { id: "admin", name: "Club Admin Chat", restricted_roles: ["club_admin"] },
  ];

  it("lets privileged viewers see generic and restricted folders", () => {
    expect(filterVisibleVaultFolders(folders, {
      isPrivilegedViewer: true,
      restrictClubRootToChatFolders: false,
      clubRoles: new Set(),
    }).map((folder) => folder.id)).toEqual(["policies", "images", "coach", "admin"]);
  });

  it("limits a coach at club root to generic chat folders and matching restricted folders", () => {
    expect(filterVisibleVaultFolders(folders, {
      isPrivilegedViewer: false,
      restrictClubRootToChatFolders: true,
      clubRoles: new Set(["coach"]),
    }).map((folder) => folder.id)).toEqual(["images", "coach"]);
  });

  it("does not use a role from another club to reveal a restricted folder", () => {
    const roles = collectVaultClubRoles(
      [{ club_id: "club-b", role: "club_admin" }],
      "club-a",
    );
    expect(filterVisibleVaultFolders(folders, {
      isPrivilegedViewer: false,
      restrictClubRootToChatFolders: true,
      clubRoles: roles,
    }).map((folder) => folder.id)).toEqual(["images"]);
  });

  it("keeps privileged role visibility separate from club-root chat narrowing", () => {
    expect(filterVisibleVaultFolders(folders, {
      isPrivilegedViewer: true,
      restrictClubRootToChatFolders: true,
      clubRoles: new Set(["coach"]),
    }).map((folder) => folder.id)).toEqual(["images", "coach", "admin"]);
  });

  it("preserves existing organisation-name abbreviations case-insensitively", () => {
    expect(abbreviateVaultOrganisationName("Riverside Football Club")).toBe("Riverside FC");
    expect(abbreviateVaultOrganisationName("District SOCCER CLUB ")).toBe("District SC");
    expect(abbreviateVaultOrganisationName("")).toBe("");
  });
});
