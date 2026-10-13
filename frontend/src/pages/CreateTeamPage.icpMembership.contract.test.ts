import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
it("submits non-admin team requests through requestLiveTeamCreation on ICP", () => {
    expect(source).toContain("requestLiveTeamCreation(");
  });


const source = readFileSync(resolve(process.cwd(), "src/pages/CreateTeamPage.tsx"), "utf8");

describe("CreateTeamPage ICP membership wiring", () => {
  it("assigns the creator as team_admin via addLiveRoleGrant when membership is ICP-routed", () => {
    expect(source).toContain("addLiveRoleGrant(ctx, ctx.identity.getPrincipal(), clubId!, \"team_admin\", team.id)");
  });

  it("assigns an existing-user team admin via addLiveRoleGrant, parsing their id as a principal", () => {
    expect(source).toContain(
      'addLiveRoleGrant(ctx, Principal.fromText(adminAssignment.userId!), clubId!, "team_admin", team.id)',
    );
  });

  it("routes email invites through createLivePendingInvite when membership is ICP-routed", () => {
    expect(source).toContain("createLivePendingInvite(ctx, {");
    expect(source).toContain("adminAssignment?.type === 'email_invite' && adminAssignment.inviteEmail && adminAssignment.inviteName && membershipOnIcp");
  });

  it("still creates the Supabase team row unconditionally via withFeatureBackend", () => {
    expect(source).toContain('const { data: team, error: teamError } = await withFeatureBackend<{ data: { id: string; name?: string } | null; error: { code?: string } | null }>("membership", {');
  });
});
