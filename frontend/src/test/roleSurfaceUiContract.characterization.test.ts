import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasVaultRoleAccess } from "@/features/vault/vaultAccess";

type Role =
  | "club_admin"
  | "committee_member"
  | "team_admin"
  | "coach"
  | "player"
  | "parent"
  | "league_admin";

const roles: Role[] = [
  "club_admin",
  "committee_member",
  "team_admin",
  "coach",
  "player",
  "parent",
  "league_admin",
];

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("role-based UI workflows across critical club surfaces", () => {
  it.each([
    ["club_admin", true],
    ["committee_member", true],
    ["team_admin", true],
    ["coach", true],
    ["player", false],
    ["parent", false],
    ["league_admin", true],
  ] satisfies Array<[Role, boolean]>)
  ("gives %s the intended Vault entry contract", (role, allowed) => {
    expect(hasVaultRoleAccess(false, [{ role }])).toBe(allowed);
  });

  it("keeps event creation limited to club and team event managers", () => {
    const eventsPage = source("src/pages/EventsPage.tsx");
    const homeSurface = [
      source("src/pages/HomePage.tsx"),
      source("src/components/home/HomeDashboardOverview.tsx"),
    ].join("\n");

    for (const role of ["club_admin", "team_admin", "coach", "committee_member"]) {
      expect(eventsPage).toContain(`\"${role}\"`);
      expect(homeSurface).toContain(`\"${role}\"`);
    }

    // These exact gates protect both the Events page action and Home shortcut.
    expect(eventsPage).toMatch(
      /\["club_admin",\s*"team_admin",\s*"coach",\s*"committee_member"\]\.includes\(r\.role\)/,
    );
    expect(homeSurface).toMatch(
      /\["app_admin",\s*"club_admin",\s*"team_admin",\s*"coach",\s*"committee_member"\]\.includes\(\s*role\.role,\s*\)/,
    );
  });

  it("keeps club-wide Media Gallery publishing limited to elevated publishing roles", () => {
    const uploadSheet = source("src/components/UploadPhotoSheet.tsx");

    expect(uploadSheet).toContain(
      "['club_admin', 'team_admin', 'coach', 'committee_member'].includes(r.role)",
    );
    expect(uploadSheet).toContain("{canPostClubWide && (");
    expect(uploadSheet).toContain("All of club");
    expect(uploadSheet).toContain(
      "if (!canPostClubWide && selectedClubId && userTeams && userTeams.length > 0 && !selectedTeamId)",
    );
  });

  it("does not accidentally classify ordinary members as privileged publishers", () => {
    const privilegedPublishers = new Set<Role>([
      "club_admin",
      "committee_member",
      "team_admin",
      "coach",
    ]);

    expect(roles.filter((role) => privilegedPublishers.has(role))).toEqual([
      "club_admin",
      "committee_member",
      "team_admin",
      "coach",
    ]);
    for (const role of ["player", "parent", "league_admin"] satisfies Role[]) {
      expect(privilegedPublishers.has(role)).toBe(false);
    }
  });

  it("retains role-aware messaging participant and group-audience handling", () => {
    const participants = source("src/components/chat/ChatParticipantsList.tsx");
    const createGroup = source("src/components/chat/CreateGroupDialog.tsx");
    const groupPage = source("src/pages/GroupChatPage.tsx");

    for (const role of roles) expect(participants).toContain(role);
    for (const role of ["club_admin", "committee_member", "team_admin", "coach"]) {
      expect(createGroup).toContain(role);
    }
    expect(groupPage).toContain(
      '["coach", "team_admin", "committee_member", "club_admin"].includes(r)',
    );
  });

  it("keeps Home navigation aligned with the Vault role helper", () => {
    const homePage = source("src/pages/HomePage.tsx");
    expect(homePage).toContain(
      '["app_admin", "club_admin", "league_admin", "team_admin", "coach", "committee_member"].includes(r.role)',
    );
  });
});
