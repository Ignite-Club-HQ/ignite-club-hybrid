import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  resolveInviteNotificationPath,
  resolveJoinedMemberPath,
  resolveProcessedJoinRequestPath,
} from "./membershipNotificationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, Result[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) {
      query[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return query; };
    }
    query.maybeSingle = async () => script[table]?.shift() ?? { data: null, error: null };
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, calls };
}

describe("membership notification repository", () => {
  it.each([
    [{ status: "accepted", metadata: { mini_league_id: "league-a" }, team_id: "team-a", club_id: "club-a", invite_token: "token" }, "/mini-leagues/league-a"],
    [{ status: "auto_accepted", metadata: {}, team_id: "team-a", club_id: "club-a", invite_token: "token" }, "/teams/team-a"],
    [{ status: "accepted", metadata: null, team_id: null, club_id: "club-a", invite_token: "token" }, "/clubs/club-a"],
    [{ status: "pending", metadata: null, team_id: "team-a", club_id: "club-a", invite_token: "team-token" }, "/join/team-token"],
    [{ status: "pending", metadata: null, team_id: null, club_id: "club-a", invite_token: "club-token" }, "/join/p/club-token"],
  ] as const)("resolves an invite according to current status and scope", async (data, path) => {
    const fake = scriptedClient({ pending_invites: [{ data, error: null }] });
    await expect(resolveInviteNotificationPath("invite-a", fake.client)).resolves.toBe(path);
  });

  it.each([
    [null],
    [{ status: "accepted", metadata: {}, team_id: null, club_id: null, invite_token: null }],
    [{ status: "pending", metadata: null, team_id: null, club_id: "club-a", invite_token: null }],
  ])("does not invent a destination for incomplete invite data", async (data) => {
    await expect(resolveInviteNotificationPath("invite-a", scriptedClient({ pending_invites: [{ data, error: null }] }).client)).resolves.toBeNull();
  });

  it("ignores malformed mini-league metadata and uses the team", async () => {
    const data = { status: "accepted", metadata: { mini_league_id: 42 }, team_id: "team-a", club_id: "club-a", invite_token: "token" };
    await expect(resolveInviteNotificationPath("invite-a", scriptedClient({ pending_invites: [{ data, error: null }] }).client)).resolves.toBe("/teams/team-a");
  });

  it.each([
    ["mini_leagues", "/mini-leagues/scope-a"],
    ["clubs", "/clubs/scope-a"],
    ["teams", "/teams/scope-a"],
  ] as const)("resolves member-joined scope as %s", async (matched, path) => {
    const fake = scriptedClient({
      mini_leagues: [{ data: matched === "mini_leagues" ? { id: "scope-a" } : null, error: null }],
      clubs: [{ data: matched === "clubs" ? { id: "scope-a" } : null, error: null }],
    });
    await expect(resolveJoinedMemberPath("scope-a", fake.client)).resolves.toBe(path);
    if (matched === "mini_leagues") expect(fake.calls.some((call) => call.table === "clubs")).toBe(false);
  });

  it.each([
    [{ id: "scope-a" }, "/clubs/scope-a"],
    [null, "/teams/scope-a"],
  ] as const)("resolves a processed join request from accessible club existence", async (data, path) => {
    await expect(resolveProcessedJoinRequestPath("scope-a", scriptedClient({ clubs: [{ data, error: null }] }).client)).resolves.toBe(path);
  });
});
