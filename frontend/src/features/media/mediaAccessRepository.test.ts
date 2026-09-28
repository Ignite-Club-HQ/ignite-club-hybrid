import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchMediaFilterClubs,
  fetchMediaFilterTeams,
  fetchMediaProAccess,
  fetchMediaUserRoles,
} from "./mediaAccessRepository";

type Client = SupabaseClient<Database>;
type Result = { data: any; error: any };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, Result[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, any> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    };
    for (const method of ["select", "eq", "in", "is", "order"]) query[method] = record(method);
    const take = () => script[table]?.shift() ?? { data: null, error: null };
    query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as Client, calls };
}

describe("Media access repository", () => {
  it("reads roles for exactly the authenticated user and propagates denial", async () => {
    const roles = [{ role: "club_admin", club_id: "club-a", team_id: null }];
    const success = scriptedClient({ user_roles: [{ data: roles, error: null }] });
    await expect(fetchMediaUserRoles("user-a", success.client)).resolves.toEqual(roles);
    expect(success.calls).toContainEqual({ table: "user_roles", method: "eq", args: ["user_id", "user-a"] });

    const failure = { message: "denied" };
    const denied = scriptedClient({ user_roles: [{ data: null, error: failure }] });
    await expect(fetchMediaUserRoles("user-a", denied.client)).rejects.toEqual(failure);
  });

  it("includes the active club and short-circuits on inherited club Pro", async () => {
    const { client, calls } = scriptedClient({
      club_subscriptions: [{ data: [{ club_id: "club-active", admin_pro_override: true }], error: null }],
      teams: [{ data: [{ id: "team-a", club_id: "club-parent" }], error: null }],
    });
    await expect(fetchMediaProAccess({
      roleClubIds: ["club-role"], roleTeamIds: ["team-a"], activeClubId: "club-active",
    }, client)).resolves.toBe(true);
    expect(calls).toContainEqual({
      table: "club_subscriptions", method: "in", args: ["club_id", ["club-role", "club-active"]],
    });
    expect(calls.some((call) => call.table === "team_subscriptions")).toBe(false);
  });

  it("checks a team parent club, then team entitlement, then legacy club Pro", async () => {
    const { client, calls } = scriptedClient({
      club_subscriptions: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      teams: [{ data: [{ id: "team-a", club_id: "club-parent" }], error: null }],
      team_subscriptions: [{ data: [{ team_id: "team-a", is_pro: false }], error: null }],
      clubs: [{ data: [{ id: "club-parent" }], error: null }],
    });
    await expect(fetchMediaProAccess({
      roleClubIds: ["club-role"], roleTeamIds: ["team-a"], activeClubId: null,
    }, client)).resolves.toBe(true);
    expect(calls).toContainEqual({
      table: "club_subscriptions", method: "in", args: ["club_id", ["club-parent"]],
    });
    expect(calls).toContainEqual({ table: "clubs", method: "eq", args: ["is_pro", true] });
  });

  it("fails closed without any club or team candidate", async () => {
    const { client, calls } = scriptedClient({});
    await expect(fetchMediaProAccess({
      roleClubIds: [], roleTeamIds: [], activeClubId: null,
    }, client)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("deduplicates club filters and returns an intentional safe empty fallback", async () => {
    const clubs = [{ id: "club-a", name: "A" }];
    const { client, calls } = scriptedClient({ clubs: [{ data: clubs, error: null }] });
    await expect(fetchMediaFilterClubs(["club-a", "club-a"], client)).resolves.toEqual(clubs);
    expect(calls).toContainEqual({ table: "clubs", method: "in", args: ["id", ["club-a"]] });
    await expect(fetchMediaFilterClubs([], client)).resolves.toEqual([]);
  });

  it("excludes archived teams and orders the accessible picker model", async () => {
    const teams = [{ id: "team-a", name: "A", club_id: "club-a" }];
    const { client, calls } = scriptedClient({ teams: [{ data: teams, error: null }] });
    await expect(fetchMediaFilterTeams(["team-a"], client)).resolves.toEqual(teams);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "teams", method: "is", args: ["deleted_at", null] },
      { table: "teams", method: "order", args: ["name"] },
    ]));
  });
});
