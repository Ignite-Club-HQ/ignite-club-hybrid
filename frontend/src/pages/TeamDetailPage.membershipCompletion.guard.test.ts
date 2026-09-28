import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/TeamDetailPage.tsx"), "utf8");

describe("Team Detail membership cache ownership", () => {
  it("delegates self-leave and full member removal to distinct completion policies", () => {
    expect(source).toContain("refreshAfterLeavingTeam(queryClient, id!)");
    expect(source).toContain("refreshRemovedTeamMember(queryClient, id)");
  });

  it("uses exact role and child completion policies for narrower mutations", () => {
    expect(source.match(/refreshTeamRoleChange\(queryClient, id!\)/g)).toHaveLength(2);
    expect(source).toContain("refreshRemovedTeamChild(queryClient, id)");
  });

  it("does not retain the replaced inline membership key sequences", () => {
    const leaveStart = source.indexOf("refreshAfterLeavingTeam(queryClient, id!)");
    expect(source.slice(leaveStart, leaveStart + 500)).not.toContain(
      'queryKey: ["user-memberships-for-events"]',
    );
    const removalStart = source.indexOf("refreshRemovedTeamMember(queryClient, id)");
    expect(source.slice(removalStart, removalStart + 400)).not.toContain(
      'queryKey: ["authorized-scopes"]',
    );
  });
});
