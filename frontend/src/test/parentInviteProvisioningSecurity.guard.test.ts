import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Parent-invite child provisioning must stay:
 *  - authorization-safe: the public RPC verifies guardian against auth.uid();
 *  - private where it accepts an explicit user id (trigger-only helper);
 *  - version-controlled: the profile-claim function and its trigger live in a
 *    forward-only migration, not just in the hosted database.
 */

const migrationsDir = "supabase/migrations";
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"));
const allSql = migrations.join("\n");

const clientApi = readFileSync("src/features/membership/acceptParentInvite.ts", "utf8");
const joinTeamPage = readFileSync("src/pages/JoinTeamPage.tsx", "utf8");
const completeProfilePage = readFileSync("src/pages/CompleteProfilePage.tsx", "utf8");

describe("parent invite provisioning security", () => {
  it("keeps the user-id-taking provisioning function private", () => {
    expect(allSql).toContain("public._provision_invite_children_internal(");
    expect(allSql).toMatch(
      /REVOKE ALL ON FUNCTION public\._provision_invite_children_internal\(uuid, uuid\) FROM authenticated/
    );
    expect(allSql).toMatch(
      /REVOKE ALL ON FUNCTION public\._provision_invite_children_internal\(uuid, uuid\) FROM anon/
    );
    expect(allSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\._provision_invite_children_internal\([^)]*\) TO [^;]*authenticated/
    );
  });

  it("authorises the two-argument RPC against auth.uid() and invite ownership", () => {
    const start = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.provision_invite_children(");
    expect(start).toBeGreaterThan(-1);
    const fn = allSql.slice(start, start + 15000);
    expect(fn).toContain("_caller uuid := auth.uid()");
    expect(fn).toContain("_caller <> _guardian_id");
    expect(fn).toContain("invite_not_for_this_user");
    expect(fn).toContain("lower(btrim(_invite.invited_email)) = _guardian_email");
  });

  it("revokes the public wrapper from PUBLIC and anon", () => {
    expect(allSql).toContain("REVOKE ALL ON FUNCTION public.provision_invite_children(uuid, uuid) FROM PUBLIC;");
    expect(allSql).toContain("REVOKE ALL ON FUNCTION public.provision_invite_children(uuid, uuid) FROM anon;");
    expect(allSql).toContain(
      "GRANT EXECUTE ON FUNCTION public.provision_invite_children(uuid, uuid) TO authenticated, service_role;"
    );
  });

  it("version-controls the profile-claim function and recreates its trigger deterministically", () => {
    expect(allSql).toContain("CREATE OR REPLACE FUNCTION public.claim_pending_invites_on_profile_create()");
    expect(allSql).toContain(
      "DROP TRIGGER IF EXISTS claim_pending_invites_on_profile_create_trigger ON public.profiles;"
    );
    expect(allSql).toContain("AFTER INSERT ON public.profiles");
  });

  it("provisions children before the invite is marked accepted", () => {
    const start = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.claim_pending_invites_on_profile_create()");
    const fn = allSql.slice(start, start + 6000);
    const provision = fn.indexOf("provision_invite_children(inv.id, NEW.id)");
    const accept = fn.indexOf("SET status = 'accepted'");
    expect(provision).toBeGreaterThan(-1);
    expect(accept).toBeGreaterThan(provision);

    const roleFnStart = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.auto_accept_pending_invites_on_role()");
    const roleFn = allSql.slice(roleFnStart, roleFnStart + 8000);
    expect(roleFn.indexOf("provision_invite_children(a.id, NEW.user_id)")).toBeLessThan(
      roleFn.indexOf("SET status = 'accepted'")
    );
  });

  it("rejects invalid or out-of-scope existing child references atomically", () => {
    const start = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public._provision_invite_children_internal(");
    const fn = allSql.slice(start, start + 12000);
    expect(fn).toContain("referenced_child_not_found");
    expect(fn).toContain("referenced_child_out_of_scope");
    expect(fn).toContain("invalid_child_name");
    expect(fn).toContain("child_team_assignment_failed");
  });

  it("passes the signed-in guardian to the secured RPC on both frontend paths", () => {
    expect(clientApi).toContain("guardianId: string;");
    expect(joinTeamPage).toContain("guardianId: user.id");
    expect(completeProfilePage).toContain('.in("status", ["pending", "accepted"])');
    expect(completeProfilePage).toContain("guardianId: user.id");
  });

  it("invalidates children, membership and RSVP caches after recovery", () => {
    const branch = joinTeamPage.slice(
      joinTeamPage.indexOf("const childIds = await provisionInviteChildren("),
      joinTeamPage.indexOf("Couldn't finish setting up")
    );
    expect(branch).toContain('queryKey: ["children"]');
    expect(branch).toContain("queryKey: membershipKeys.userRoles()");
    expect(branch).toContain('queryKey: ["rsvps"]');
  });
});
