import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

import {
  getParentInviteErrorMessage,
  isNotChildParentInviteError,
} from "@/features/membership/acceptParentInvite";

const joinTeamPage = readFileSync("src/pages/JoinTeamPage.tsx", "utf8");
const welcomeDialog = readFileSync("src/components/PendingInviteWelcomeDialog.tsx", "utf8");
const completeProfilePage = readFileSync("src/pages/CompleteProfilePage.tsx", "utf8");
const inertReferenceMigrations = readdirSync("../reference/backend/supabase/migrations")
  .filter((name) => name.endsWith(".sql.md"))
  .sort()
  .map((name) => readFileSync(`../reference/backend/supabase/migrations/${name}`, "utf8"))
  .join("\n");

function latestFunctionDefinition(functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = inertReferenceMigrations.lastIndexOf(marker);
  if (start < 0) return "";
  const nextFunction = inertReferenceMigrations.indexOf(
    "CREATE OR REPLACE FUNCTION public.",
    start + marker.length,
  );
  return inertReferenceMigrations.slice(start, nextFunction < 0 ? undefined : nextFunction);
}

/**
 * A parent invitation that carries child metadata must be accepted atomically.
 * These guards keep both acceptance entry points on the transactional RPC so a
 * failed child creation/assignment can never leave a consumed invite behind.
 */
describe("parent invite atomic acceptance", () => {
  it("JoinTeamPage accepts child-carrying parent invites through the RPC", () => {
    // Shared helper used by both the named-invite and shareable-link paths.
    expect(joinTeamPage).toContain("provisionChildrenFromInviteMetadata");
    expect(joinTeamPage).toContain("acceptParentTeamInvite({ inviteId })");
  });

  it("JoinTeamPage surfaces a retryable error instead of continuing on failure", () => {
    const branch = joinTeamPage.slice(
      joinTeamPage.indexOf("acceptParentTeamInvite({ inviteId })"),
      joinTeamPage.indexOf("if (metadata.child_id) {")
    );
    expect(branch).toContain("throw new Error(getParentInviteErrorMessage(rpcError))");
    // The old flow logged child failures and kept going.
    expect(branch).not.toContain("continue;");
    expect(branch).not.toContain("createChildForParentOrReuse");
    expect(branch).not.toContain("child_team_assignments");
  });

  it("PendingInviteWelcomeDialog routes child metadata invites to the RPC", () => {
    expect(welcomeDialog).toContain("acceptParentTeamInvite({ inviteId: invite.id })");
    expect(welcomeDialog).toContain("hasChildMetadata");
  });

  it("CompleteProfilePage uses one authoritative path for standard parent invites", () => {
    const branch = completeProfilePage.slice(
      completeProfilePage.indexOf("if (isStandardParentChildInvite)"),
      completeProfilePage.indexOf("// Check if role already exists")
    );
    expect(branch).toContain('if (invite.status === "pending")');
    expect(branch).toContain("acceptParentTeamInvite({ inviteId: invite.id })");
    expect(branch).toContain("provisionInviteChildren({");
    expect(branch).toContain("continue;");
    expect(branch).not.toContain("createChildForParentOrReuse");
    expect(branch).not.toContain("child_team_assignments");
  });

  it("PendingInviteWelcomeDialog leaves the invite pending when the RPC fails", () => {
    const branch = welcomeDialog.slice(
      welcomeDialog.indexOf("if (hasChildMetadata)"),
      welcomeDialog.indexOf("// Non-guardian path")
    );
    expect(branch).toContain("continue; // no partial membership, no acceptance");
    expect(branch).not.toContain('.update({ status: "accepted"');
  });

  it("does not mark reusable join links as consumed by the parent RPC", () => {
    expect(welcomeDialog).toContain("mini_league_parent_join_link");
    expect(welcomeDialog).toContain("league_admin_join_link");
  });

  it("maps RPC failures to non-technical, retryable messages", () => {
    expect(getParentInviteErrorMessage({ message: "invite_not_for_this_user" })).toContain(
      "different email address"
    );
    expect(getParentInviteErrorMessage({ message: "child_team_assignment_failed" })).toContain(
      "Nothing was saved"
    );
    expect(getParentInviteErrorMessage({ message: "referenced_child_out_of_scope" })).toContain(
      "no longer matches this team"
    );
    // Never leaks raw SQL / personal data.
    expect(getParentInviteErrorMessage({ message: "boom: child Sam Smith" })).not.toContain("Sam");
  });

  it("recognises invites that are not child-carrying parent invites", () => {
    expect(isNotChildParentInviteError({ message: "not_a_child_parent_invite" })).toBe(true);
    expect(isNotChildParentInviteError({ message: "child_create_failed" })).toBe(false);
  });

  it("keeps non-parent invitation journeys on their existing paths", () => {
    expect(joinTeamPage).toContain("claim_mini_league_invite");
    expect(welcomeDialog).toContain("accept_guardian_parent_invite");
    expect(joinTeamPage).toContain('metadata?.kind === "mini_league_parent_join_link"');
  });

  it("keeps the profile-creation invite claimant in version-controlled migrations", () => {
    const claimant = latestFunctionDefinition("claim_pending_invites_on_profile_create");
    expect(claimant).not.toBe("");
    expect(claimant).toContain("children");
    expect(claimant).toMatch(/provision_invite_children|_provision_invite_children_internal/);
  });

  it("never lets the user-role trigger consume a normal parent invite without provisioning children", () => {
    const autoAccept = latestFunctionDefinition("auto_accept_pending_invites_on_role");
    expect(autoAccept).not.toBe("");
    expect(autoAccept).toContain("children");
    expect(autoAccept).toMatch(/provision_invite_children|_provision_invite_children_internal/);
  });

  it("does not let an authenticated caller provision children for another user", () => {
    const provisioner = latestFunctionDefinition("provision_invite_children");
    expect(provisioner).not.toBe("");
    expect(provisioner).toContain("auth.uid()");
    expect(provisioner).not.toContain("p_user_id");
    expect(provisioner).toMatch(/_uid\s*<>\s*_guardian_id|_caller\s*<>\s*_guardian_id/i);
  });

  it("checks invite ownership inside the provisioning RPC rather than trusting its caller", () => {
    const provisioner = latestFunctionDefinition("provision_invite_children");
    expect(provisioner).toContain("invited_user_id");
    expect(provisioner).toMatch(/_invite\.invited_user_id\s*=\s*_guardian_id/i);
    expect(provisioner).toContain("invite_not_for_this_user");
  });
});
