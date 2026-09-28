import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  buildPendingInviteChildMatches,
  fetchInvitationClubBranding,
  fetchInvitationClubChildren,
  fetchInvitationIdentityMap,
  fetchTeamMemberIds,
  fetchTeamMemberProfiles,
  fetchPendingInviteChildren,
  searchInvitableProfiles,
  searchBulkInvitationCandidates,
  searchBulkSecondParentProfiles,
  searchPendingClubInvites,
  searchSecondParentProfiles,
} from "./membershipInvitationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(
  script: Record<string, Result | Result[]>,
  rpcResult: Result | Result[] = { data: null, error: null },
) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    };
    query.select = record("select");
    query.eq = record("eq");
    query.in = record("in");
    query.ilike = record("ilike");
    query.limit = record("limit");
    const take = () => {
      const result = script[table];
      if (Array.isArray(result)) return result.shift() ?? { data: null, error: null };
      return result ?? { data: null, error: null };
    };
    query.single = async () => take();
    query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject);
    return query;
  };
  const rpc = async (name: string, args: unknown) => {
    calls.push({ table: "$rpc", method: name, args: [args] });
    if (Array.isArray(rpcResult)) return rpcResult.shift() ?? { data: null, error: null };
    return rpcResult;
  };
  return { client: { from, rpc } as unknown as IgniteSupabaseClient, calls };
}

describe("membership invitation read repository", () => {
  it("reads member IDs from the exact team scope without changing order", async () => {
    const { client, calls } = scriptedClient({
      user_roles: { data: [{ user_id: "user-b" }, { user_id: "user-a" }], error: null },
    });

    await expect(fetchTeamMemberIds("team-a", client)).resolves.toEqual(["user-b", "user-a"]);
    expect(calls).toEqual([
      { table: "user_roles", method: "select", args: ["user_id"] },
      { table: "user_roles", method: "eq", args: ["team_id", "team-a"] },
    ]);
  });

  it("returns no member IDs when the read has no data", async () => {
    const { client } = scriptedClient({ user_roles: { data: null, error: { message: "denied" } } });
    await expect(fetchTeamMemberIds("team-a", client)).resolves.toEqual([]);
  });

  it("loads profiles for the exact member IDs", async () => {
    const profiles = [{ id: "user-a", display_name: "Alex", avatar_url: null }];
    const loadProfiles = vi.fn(async () => ({ data: profiles }));

    await expect(fetchTeamMemberProfiles(["user-a"], loadProfiles)).resolves.toEqual(profiles);
    expect(loadProfiles).toHaveBeenCalledWith(["user-a"]);
  });

  it("does not perform a profile read for an empty member scope", async () => {
    const loadProfiles = vi.fn();
    await expect(fetchTeamMemberProfiles([], loadProfiles)).resolves.toEqual([]);
    expect(loadProfiles).not.toHaveBeenCalled();
  });

  it("reads only invitation branding for the exact club", async () => {
    const branding = { name: "Synthetic Club", logo_url: null, contact_email: "club@example.test", invite_email_style: "discover" };
    const { client, calls } = scriptedClient({ clubs: { data: branding, error: null } });

    await expect(fetchInvitationClubBranding("club-a", client)).resolves.toEqual(branding);
    expect(calls).toEqual([
      { table: "clubs", method: "select", args: ["name, logo_url, contact_email, invite_email_style"] },
      { table: "clubs", method: "eq", args: ["id", "club-a"] },
    ]);
  });

  it("preserves the existing null branding result", async () => {
    const { client } = scriptedClient({ clubs: { data: null, error: { message: "missing" } } });
    await expect(fetchInvitationClubBranding("club-a", client)).resolves.toBeNull();
  });

  it("combines team-assigned and parent-owned children within the exact club", async () => {
    const { client, calls } = scriptedClient({
      teams: { data: [{ id: "team-a" }, { id: "team-b" }], error: null },
      child_team_assignments: { data: [{ child_id: "child-team" }, { child_id: "child-shared" }], error: null },
      user_roles: { data: [{ user_id: "parent-a" }, { user_id: "parent-a" }], error: null },
      children: [
        { data: [{ id: "child-shared" }, { id: "child-parent" }], error: null },
        { data: [
          { id: "child-team", name: "Team Child", year_of_birth: 2015, parent_id: "parent-a" },
          { id: "child-shared", name: "Shared Child", year_of_birth: 2016, parent_id: "parent-a" },
          { id: "child-parent", name: "Parent Child", year_of_birth: null, parent_id: "parent-b" },
        ], error: null },
      ],
    });
    const loadProfiles = vi.fn(async () => ({ data: [
      { id: "parent-a", display_name: "Parent A", avatar_url: null },
      { id: "parent-b", display_name: "Parent B", avatar_url: null },
    ] }));

    await expect(fetchInvitationClubChildren("club-a", client, loadProfiles)).resolves.toEqual([
      { id: "child-team", name: "Team Child", year_of_birth: 2015, parent_id: "parent-a", parent_name: "Parent A" },
      { id: "child-shared", name: "Shared Child", year_of_birth: 2016, parent_id: "parent-a", parent_name: "Parent A" },
      { id: "child-parent", name: "Parent Child", year_of_birth: null, parent_id: "parent-b", parent_name: "Parent B" },
    ]);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "teams", method: "eq", args: ["club_id", "club-a"] },
      { table: "child_team_assignments", method: "in", args: ["team_id", ["team-a", "team-b"]] },
      { table: "user_roles", method: "eq", args: ["club_id", "club-a"] },
      { table: "user_roles", method: "eq", args: ["role", "parent"] },
      { table: "children", method: "in", args: ["id", ["child-team", "child-shared", "child-parent"]] },
    ]));
    expect(loadProfiles).toHaveBeenCalledWith(["parent-a", "parent-b"]);
  });

  it("supports parent-role discovery when the club has no teams", async () => {
    const { client, calls } = scriptedClient({
      teams: { data: [], error: null },
      user_roles: { data: [{ user_id: "parent-a" }], error: null },
      children: [
        { data: [{ id: "child-a" }], error: null },
        { data: [{ id: "child-a", name: "Child A", year_of_birth: 2017, parent_id: "parent-a" }], error: null },
      ],
    });
    const loadProfiles = vi.fn(async () => ({ data: [] }));

    await expect(fetchInvitationClubChildren("club-a", client, loadProfiles)).resolves.toEqual([
      { id: "child-a", name: "Child A", year_of_birth: 2017, parent_id: "parent-a", parent_name: "Unknown" },
    ]);
    expect(calls.some((call) => call.table === "child_team_assignments")).toBe(false);
  });

  it("stops before child detail and profile reads when neither discovery path finds children", async () => {
    const { client, calls } = scriptedClient({
      teams: { data: [], error: null },
      user_roles: { data: [], error: null },
    });
    const loadProfiles = vi.fn();

    await expect(fetchInvitationClubChildren("club-a", client, loadProfiles)).resolves.toEqual([]);
    expect(calls.some((call) => call.table === "children")).toBe(false);
    expect(loadProfiles).not.toHaveBeenCalled();
  });

  it("uses Unknown for missing and null parent profiles without dropping children", async () => {
    const { client } = scriptedClient({
      teams: { data: [{ id: "team-a" }], error: null },
      child_team_assignments: { data: [{ child_id: "child-a" }, { child_id: "child-b" }], error: null },
      user_roles: { data: [], error: null },
      children: { data: [
        { id: "child-a", name: "Child A", year_of_birth: null, parent_id: "missing-parent" },
        { id: "child-b", name: "Child B", year_of_birth: null, parent_id: null },
      ], error: null },
    });
    const loadProfiles = vi.fn(async () => ({ data: [] }));

    const result = await fetchInvitationClubChildren("club-a", client, loadProfiles);
    expect(result.map(({ parent_name }) => parent_name)).toEqual(["Unknown", "Unknown"]);
    expect(loadProfiles).toHaveBeenCalledWith(["missing-parent", null]);
  });

  it("reads pending child metadata from the exact team and pending status", async () => {
    const { client, calls } = scriptedClient({
      pending_invites: { data: [{
        id: "invite-a",
        invited_label: "Parent A",
        metadata: { children: [{ name: " Child A ", yearOfBirth: 2016 }] },
      }], error: null },
    });

    await expect(fetchPendingInviteChildren("team-a", client)).resolves.toEqual([{
      id: "pending-invite-a-Child A",
      name: "Child A",
      year_of_birth: 2016,
      parent_name: "Parent A",
      parent_id: "invite-a",
      isPending: true,
      inviteId: "invite-a",
    }]);
    expect(calls).toEqual([
      { table: "pending_invites", method: "select", args: ["id, invited_label, metadata"] },
      { table: "pending_invites", method: "eq", args: ["team_id", "team-a"] },
      { table: "pending_invites", method: "eq", args: ["status", "pending"] },
    ]);
  });

  it("ignores absent, malformed and child-less metadata", () => {
    expect(buildPendingInviteChildMatches([
      { id: "invite-a", invited_label: "Parent A", metadata: null },
      { id: "invite-b", invited_label: "Parent B", metadata: { children: "invalid" } },
      { id: "invite-c", invited_label: "Parent C", metadata: { children: [null, {}, { name: "" }] } },
    ])).toEqual([]);
  });

  it("deduplicates the same normalized child within a canonical invite and year", () => {
    expect(buildPendingInviteChildMatches([{
      id: "invite-a",
      invited_label: "Parent A",
      metadata: { children: [
        { name: "Casey", yearOfBirth: 2015 },
        { name: " casey ", yearOfBirth: 2015 },
        { name: "Casey", yearOfBirth: 2016 },
      ] },
    }])).toHaveLength(2);
  });

  it("preserves source order and the existing Unknown/year fallback behavior", () => {
    expect(buildPendingInviteChildMatches([{
      id: "invite-a",
      invited_label: "",
      metadata: { children: [
        { name: "First", yearOfBirth: 0 },
        { name: "Second", yearOfBirth: "2015" },
      ] },
    }])).toEqual([
      expect.objectContaining({ name: "First", year_of_birth: null, parent_name: "Unknown" }),
      expect.objectContaining({ name: "Second", year_of_birth: "2015", parent_name: "Unknown" }),
    ]);
  });

  it("searches invitable profiles through the bounded security-definer RPC", async () => {
    const profiles = [{ id: "user-a", display_name: "Alex", avatar_url: null, masked_email: "a***@test" }];
    const { client, calls } = scriptedClient({}, { data: profiles, error: null });

    await expect(searchInvitableProfiles("Al", client)).resolves.toEqual(profiles);
    expect(calls).toEqual([{
      table: "$rpc",
      method: "search_invitable_profiles",
      args: [{ _query: "Al", _limit: 8 }],
    }]);
  });

  it("scopes invitable profile searches to the active club when provided", async () => {
    const { client, calls } = scriptedClient({}, { data: [], error: null });
    await searchInvitableProfiles("Alex", client, "club-1");
    expect(calls[0]).toEqual({
      table: "$rpc",
      method: "search_invitable_profiles",
      args: [{ _query: "Alex", _limit: 8, _club_id: "club-1" }],
    });
  });

  it("scopes parent candidates to the destination club so another club's guardian cannot be attached", async () => {
    const inClub = { id: "parent-a", display_name: "Alex In Club", avatar_url: null, masked_email: null };
    const otherClub = { id: "parent-b", display_name: "Alex Other Club", avatar_url: null, masked_email: null };
    const { client, calls } = scriptedClient({
      user_roles: { data: [{ user_id: "parent-a" }], error: null },
    }, { data: [inClub, otherClub], error: null });
    await expect(searchInvitableProfiles("Alex", client, "club-a")).resolves.toEqual([inClub]);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "$rpc", method: "search_invitable_profiles", args: [{ _query: "Alex", _limit: 8, _club_id: "club-a" }] },
      { table: "user_roles", method: "eq", args: ["club_id", "club-a"] },
      { table: "user_roles", method: "in", args: ["user_id", ["parent-a", "parent-b"]] },
    ]));
  });

  it("short-circuits profile and parent searches below two characters", async () => {
    const { client, calls } = scriptedClient({});
    await expect(searchInvitableProfiles("A", client)).resolves.toEqual([]);
    await expect(searchSecondParentProfiles("A", client)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it("searches pending invitations within the exact club and enriches linked users", async () => {
    const { client, calls } = scriptedClient({ pending_invites: { data: [
      { id: "invite-a", invited_label: "Fallback A", invited_email: "a@test", invited_user_id: "user-a", metadata: {}, team_id: "team-a" },
      { id: "invite-b", invited_label: "Pending B", invited_email: "b@test", invited_user_id: null, metadata: {}, team_id: "team-b" },
    ], error: null } });
    const loadProfiles = vi.fn(async () => ({ data: [
      { id: "user-a", display_name: "Profile A", avatar_url: "avatar-a" },
    ] }));

    await expect(searchPendingClubInvites("Pend", "club-a", client, loadProfiles)).resolves.toEqual([
      { id: "pending-invite-a", display_name: "Profile A", avatar_url: "avatar-a", invited_email: "a@test", isPendingInvite: true, pendingInviteId: "invite-a", invitedUserId: "user-a" },
      { id: "pending-invite-b", display_name: "Pending B", avatar_url: null, invited_email: "b@test", isPendingInvite: true, pendingInviteId: "invite-b", invitedUserId: null },
    ]);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "pending_invites", method: "eq", args: ["club_id", "club-a"] },
      { table: "pending_invites", method: "eq", args: ["status", "pending"] },
      { table: "pending_invites", method: "ilike", args: ["invited_label", "%Pend%"] },
      { table: "pending_invites", method: "limit", args: [12] },
    ]));
    expect(loadProfiles).toHaveBeenCalledWith(["user-a"]);
  });

  it("uses invite labels when linked profile enrichment is absent", async () => {
    const { client } = scriptedClient({ pending_invites: { data: [{
      id: "invite-a", invited_label: "Fallback A", invited_email: null, invited_user_id: "user-a", metadata: {}, team_id: "team-a",
    }], error: null } });
    const loadProfiles = vi.fn(async () => ({ data: [] }));

    await expect(searchPendingClubInvites("Fa", "club-a", client, loadProfiles)).resolves.toEqual([
      expect.objectContaining({ id: "pending-invite-a", display_name: "Fallback A", avatar_url: null }),
    ]);
  });

  it("keeps two pending invites for one existing account distinct for explicit parent attachment", async () => {
    const { client } = scriptedClient({ pending_invites: { data: [
      { id: "invite-team-a", invited_label: "Alex Parent", invited_email: "alex@test", invited_user_id: "user-a", metadata: {}, team_id: "team-a" },
      { id: "invite-team-b", invited_label: "Alex Parent", invited_email: "alex@test", invited_user_id: "user-a", metadata: {}, team_id: "team-b" },
    ], error: null } });
    const loadProfiles = vi.fn(async () => ({ data: [
      { id: "user-a", display_name: "Alex Parent", avatar_url: null },
    ] }));

    const results = await searchPendingClubInvites("Alex", "club-a", client, loadProfiles);
    expect(results.map(({ id, pendingInviteId, invitedUserId }) => ({ id, pendingInviteId, invitedUserId }))).toEqual([
      { id: "pending-invite-team-a", pendingInviteId: "invite-team-a", invitedUserId: "user-a" },
      { id: "pending-invite-team-b", pendingInviteId: "invite-team-b", invitedUserId: "user-a" },
    ]);
  });

  it("searches second parents by display name with the established five-row bound", async () => {
    const profiles = [{ id: "user-a", display_name: "Alex", avatar_url: null }];
    const { client, calls } = scriptedClient({ profiles: { data: profiles, error: null } });

    await expect(searchSecondParentProfiles("Alex", client)).resolves.toEqual(profiles);
    expect(calls).toEqual([
      { table: "profiles", method: "select", args: ["id, display_name, avatar_url"] },
      { table: "profiles", method: "ilike", args: ["display_name", "%Alex%"] },
      { table: "profiles", method: "limit", args: [5] },
    ]);
  });

  it("builds exact-club identities from roles, team names and children", async () => {
    const { client, calls } = scriptedClient({
      user_roles: { data: [
        { user_id: "user-a", role: "coach", team_id: "team-a" },
        { user_id: "user-b", role: "parent", team_id: "team-b" },
      ], error: null },
      teams: { data: [{ id: "team-a", name: "U10 Blue" }, { id: "team-b", name: "U12 Gold" }], error: null },
      children: { data: [{ parent_id: "user-b", name: "Child B" }, { parent_id: null, name: "Ignored" }], error: null },
    });

    const identities = await fetchInvitationIdentityMap("club-a", ["user-a", "user-b", "user-empty"], client);
    expect(Object.keys(identities)).toEqual(["user-a", "user-b", "user-empty"]);
    expect(identities["user-a"]).toEqual({
      primaryRole: "coach",
      roleLabel: "Coach",
      contextLine: "Coach • U10 Blue",
    });
    expect(identities["user-b"]).toEqual({
      primaryRole: "parent",
      roleLabel: "Parent",
      contextLine: "Parent of Child",
    });
    expect(identities["user-empty"]).toEqual({
      primaryRole: null,
      roleLabel: "Member",
      contextLine: "Member",
    });
    expect(calls).toEqual(expect.arrayContaining([
      { table: "user_roles", method: "eq", args: ["club_id", "club-a"] },
      { table: "user_roles", method: "in", args: ["user_id", ["user-a", "user-b", "user-empty"]] },
      { table: "teams", method: "eq", args: ["club_id", "club-a"] },
      { table: "children", method: "in", args: ["parent_id", ["user-a", "user-b", "user-empty"]] },
    ]));
  });

  it("does not read identity tables without both club and user scope", async () => {
    const { client, calls } = scriptedClient({});
    await expect(fetchInvitationIdentityMap("club-a", [], client)).resolves.toEqual({});
    await expect(fetchInvitationIdentityMap("", ["user-a"], client)).resolves.toEqual({});
    expect(calls).toEqual([]);
  });

  it("combines bulk profiles then pending invites and filters existing members", async () => {
    const rpcProfiles = [
      { id: "existing", display_name: "Existing", avatar_url: null, masked_email: null },
      { id: "current", display_name: "Current", avatar_url: null, masked_email: null },
      { id: "new", display_name: "New", avatar_url: null, masked_email: null },
    ];
    const { client, calls } = scriptedClient({
      user_roles: { data: [{ user_id: "existing" }, { user_id: "current" }, { user_id: "new" }], error: null },
      pending_invites: { data: [
      { id: "invite-new", invited_label: "Duplicate New", invited_email: null, invited_user_id: "new", metadata: {}, team_id: "team-a" },
      { id: "invite-pending", invited_label: "Pending", invited_email: "p@test", invited_user_id: null, metadata: {}, team_id: "team-b" },
    ], error: null },
    }, { data: rpcProfiles, error: null });

    await expect(searchBulkInvitationCandidates(["Ne"], {
      clubId: "club-a",
      currentUserId: "current",
      selectedRole: "coach",
      existingMemberIds: ["existing", "current"],
    }, client)).resolves.toEqual([{
      term: "Ne",
      results: [
        rpcProfiles[1],
        rpcProfiles[2],
        expect.objectContaining({ id: "pending-invite-pending", pendingInviteId: "invite-pending" }),
      ],
    }]);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "pending_invites", method: "eq", args: ["club_id", "club-a"] },
      { table: "pending_invites", method: "limit", args: [8] },
    ]));
  });

  it("keeps existing profiles available when bulk-adding a parent role", async () => {
    const profile = { id: "existing", display_name: "Existing", avatar_url: null, masked_email: null };
    const { client } = scriptedClient({
      user_roles: { data: [{ user_id: "existing" }], error: null },
      pending_invites: { data: [], error: null },
    }, { data: [profile], error: null });
    const result = await searchBulkInvitationCandidates(["Ex"], {
      clubId: "club-a",
      selectedRole: "parent",
      existingMemberIds: ["existing"],
    }, client);
    expect(result[0].results).toEqual([profile]);
  });

  it("preserves term ordering for bulk second-parent searches", async () => {
    const { client } = scriptedClient({ profiles: [
      { data: [{ id: "user-a", display_name: "Alex", avatar_url: null }], error: null },
      { data: [{ id: "user-b", display_name: "Blair", avatar_url: null }], error: null },
    ] });
    await expect(searchBulkSecondParentProfiles(["Alex", "Blair"], client)).resolves.toEqual([
      { term: "Alex", results: [{ id: "user-a", display_name: "Alex", avatar_url: null }] },
      { term: "Blair", results: [{ id: "user-b", display_name: "Blair", avatar_url: null }] },
    ]);
  });
});
