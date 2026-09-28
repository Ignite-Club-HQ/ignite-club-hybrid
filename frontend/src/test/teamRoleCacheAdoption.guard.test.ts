import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const exactCompletionConsumers = [
  "src/pages/ManageTeamRolesPage.tsx",
  "src/components/TeamCaptainCard.tsx",
  "src/hooks/useAddExistingTeamMemberMutation.ts",
  "src/components/ManageRolesDialog.tsx",
  "src/components/PromoteToTeamAdminDialog.tsx",
  "src/components/AddRoleToMemberDialog.tsx",
  "src/components/LinkChildToParentSheet.tsx",
  "src/components/team/AddPlayerToParentSheet.tsx",
];

describe("team role cache policy adoption", () => {
  it.each(exactCompletionConsumers)("uses the canonical completion in %s", (path) => {
    const source = read(path);
    expect(source).toContain("refreshTeamRoleChange");
    expect(source).not.toContain('invalidateQueries({ queryKey: ["team-roles", teamId] })');
  });

  it("uses the canonical exact key for the role management read", () => {
    expect(read("src/pages/ManageTeamRolesPage.tsx")).toContain(
      "queryKey: membershipKeys.teamRoles(teamId)",
    );
  });

  it("retains broad roster invalidation for a cross-team move", () => {
    const source = read("src/components/MoveToTeamSheet.tsx");
    expect(source).toContain("membershipKeys.teamRoles()");
    expect(source).toContain("membershipKeys.teamChildren()");
  });
});
