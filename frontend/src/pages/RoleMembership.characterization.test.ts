import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { roleRequestErrorFeedback } from "@/features/membership/roleMutationFeedback";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("role and membership surface behavior before consolidation", () => {
  const clubRoles = () => source("src/pages/ManageRolesPage.tsx");
  const teamRoles = () => source("src/pages/ManageTeamRolesPage.tsx");
  const teamInvite = () =>
    [
      "src/components/AddTeamMemberSheet.tsx",
      "src/hooks/useAddExistingTeamMemberMutation.ts",
      "src/hooks/useAddPendingTeamMemberMutation.ts",
      "src/hooks/useAddBulkTeamMembersMutation.ts",
    ].map(source).join("\n");
  const miniLeagueInvite = () => source("src/components/AddMiniLeagueMemberSheet.tsx");

  it("keeps club and team query scopes independently keyed", () => {
    expect(clubRoles()).toContain('["club-members-roles", clubId]');
    expect(clubRoles()).toContain('["club-role-requests", clubId]');
    expect(teamRoles()).toContain("membershipKeys.teamRoles(teamId)");
    expect(teamRoles()).toContain('["team-role-requests", teamId]');
  });

  it("preserves role-removal constraints and team-only point reset", () => {
    expect(clubRoles()).toContain(
      'role.role === "club_admin" || role.role === "team_admin"',
    );
    expect(teamRoles()).toContain('role.role === "team_admin"');
    expect(teamRoles()).toContain("userRoleList.length <= 1");
    expect(teamRoles()).toContain("resetPointsMutation");
    expect(clubRoles()).not.toContain("resetPointsMutation");
  });

  it("preserves scoped cache and authorization feedback differences", () => {
    expect(clubRoles()).toContain('["club-roles", clubId]');
    expect(teamRoles()).toContain("refreshTeamRoleChange(queryClient, teamId)");
    expect(clubRoles()).toContain('roleRequestErrorFeedback("club", error)');
    expect(teamRoles()).toContain('roleRequestErrorFeedback("team", error)');
    expect(roleRequestErrorFeedback("club", new Error("not authorized"))).toMatchObject({
      title: "Permission denied",
      description: "You don't have permission to manage join requests. Only club admins can approve or deny requests.",
    });
    expect(roleRequestErrorFeedback("team", new Error("not authorized"))).toMatchObject({
      title: "Permission denied",
      description: "You don't have permission to manage join requests. Only team admins, coaches, and club admins can approve or deny requests.",
    });
  });

  it("keeps team child and guardian invite behavior distinct from mini-league invites", () => {
    expect(teamInvite()).toContain("<ChildAndSecondGuardianFields");
    expect(teamInvite()).toContain("ensureSecondParent");
    expect(teamInvite()).toContain("create_child_for_parent_on_team");

    expect(miniLeagueInvite()).toContain("abilityRating");
    expect(miniLeagueInvite()).toContain("child_mini_league_assignments");
    expect(miniLeagueInvite()).toContain('role: "parent"');
    expect(miniLeagueInvite()).toContain('template: "team-invite"');
  });

  it("keeps team role choices and mini-league player fields scoped", () => {
    expect(teamInvite()).toContain('value: "team_admin"');
    expect(teamInvite()).toContain('value: "coach"');
    expect(miniLeagueInvite()).toContain("Ability rating");
    expect(miniLeagueInvite()).not.toContain("value: \"team_admin\"");
  });
});
