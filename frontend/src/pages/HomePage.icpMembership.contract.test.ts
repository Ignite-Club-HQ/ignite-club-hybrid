import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/HomePage.tsx"), "utf8");

describe("HomePage ICP membership wiring", () => {
  it("routes team/league access requests through requestLiveRole when backend is ICP", () => {
    expect(source).toContain("requestLiveRole(ctx, league.club_id, selectedLeagueRole!)");
    expect(source).toContain("requestLiveRole(ctx, team.club_id, selectedTeamRole!, selectedTeam)");
    expect(source).toContain("requestLiveRole(ctx, team.club_id, role, selectedTeam)");
  });

  it("populates the public mini-league directory via listLivePublicMiniLeagues when backend is ICP", () => {
    expect(source).toContain("listLivePublicMiniLeagues(ctx)");
  });

  it("no longer disables joining or role requests for ICP accounts", () => {
    // These queries were previously disabled for ICP
    expect(source).not.toContain('enabled: !!user && teamDialogOpen && resolveAuthBackend() !== "icp"');
    expect(source).not.toContain('enabled: !!user?.id && !!selectedTeam && isAlreadyTeamMember && resolveAuthBackend() !== "icp"');
  });
});
