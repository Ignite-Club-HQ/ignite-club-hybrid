import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchVaultAccessibleClubs,
  fetchVaultAnyProAccess,
  fetchVaultAppAdmin,
  fetchVaultClubHasPro,
  fetchVaultTeamHasPro,
  fetchVaultUserRoles,
} from "./vaultAccessRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, Result[]>) {
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
    query.order = record("order");
    const take = () => script[table]?.shift() ?? { data: null, error: null };
    query.maybeSingle = async () => take();
    query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject);
    return query;
  };
  return {
    client: { from } as unknown as IgniteSupabaseClient,
    calls,
  };
}

describe("Vault access repository", () => {
  it("checks app-admin status for the exact user and role", async () => {
    const { client, calls } = scriptedClient({
      user_roles: [{ data: { role: "app_admin" }, error: null }],
    });
    await expect(fetchVaultAppAdmin("user-a", client)).resolves.toBe(true);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "user_roles", method: "eq", args: ["user_id", "user-a"] },
      { table: "user_roles", method: "eq", args: ["role", "app_admin"] },
    ]));
  });

  it("returns an empty role model when the read has no data", async () => {
    const { client } = scriptedClient({ user_roles: [{ data: null, error: null }] });
    await expect(fetchVaultUserRoles("user-a", client)).resolves.toEqual([]);
  });

  it("lets app admins read the ordered club list without a role lookup", async () => {
    const clubs = [{ id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 }];
    const { client, calls } = scriptedClient({ clubs: [{ data: clubs, error: null }] });
    await expect(fetchVaultAccessibleClubs("user-a", true, client)).resolves.toEqual(clubs);
    expect(calls.some((call) => call.table === "user_roles")).toBe(false);
    expect(calls).toContainEqual({ table: "clubs", method: "order", args: ["name"] });
  });

  it("combines direct and team-derived clubs without widening duplicates", async () => {
    const clubs = [
      { id: "club-a", name: "Club A", is_pro: true, storage_used_bytes: 0 },
      { id: "club-b", name: "Club B", is_pro: false, storage_used_bytes: 0 },
    ];
    const { client, calls } = scriptedClient({
      user_roles: [{ data: [
        { club_id: "club-a", team_id: null },
        { club_id: null, team_id: "team-b" },
      ], error: null }],
      teams: [{ data: [{ club_id: "club-a" }, { club_id: "club-b" }], error: null }],
      clubs: [{ data: clubs, error: null }],
    });
    await expect(fetchVaultAccessibleClubs("user-a", false, client)).resolves.toEqual(clubs);
    expect(calls).toContainEqual({
      table: "clubs",
      method: "in",
      args: ["id", ["club-a", "club-b"]],
    });
  });

  it("reads club and team entitlement using their exact identifiers", async () => {
    const { client, calls } = scriptedClient({
      club_subscriptions: [{ data: { admin_pro_override: true }, error: null }],
      team_subscriptions: [{ data: { is_pro_football: true }, error: null }],
    });
    await expect(fetchVaultClubHasPro("club-a", client)).resolves.toBe(true);
    await expect(fetchVaultTeamHasPro("team-a", client)).resolves.toBe(true);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "club_subscriptions", method: "eq", args: ["club_id", "club-a"] },
      { table: "team_subscriptions", method: "eq", args: ["team_id", "team-a"] },
    ]));
  });

  it("short-circuits any-Pro resolution after an inherited club subscription", async () => {
    const { client, calls } = scriptedClient({
      user_roles: [{ data: [{ club_id: null, team_id: "team-a" }], error: null }],
      teams: [{ data: [{ id: "team-a", club_id: "club-a" }], error: null }],
      club_subscriptions: [{ data: [{ club_id: "club-a", is_pro: true }], error: null }],
    });
    await expect(fetchVaultAnyProAccess("user-a", client)).resolves.toBe(true);
    expect(calls.some((call) => call.table === "team_subscriptions")).toBe(false);
    expect(calls.some((call) => call.table === "clubs")).toBe(false);
  });

  it("checks team entitlement when every related club subscription is free", async () => {
    const { client } = scriptedClient({
      user_roles: [{ data: [{ club_id: "club-a", team_id: "team-a" }], error: null }],
      teams: [{ data: [{ id: "team-a", club_id: "club-a" }], error: null }],
      club_subscriptions: [{ data: [{ club_id: "club-a", is_pro: false }], error: null }],
      team_subscriptions: [{ data: [{ team_id: "team-a", admin_pro_override: true }], error: null }],
    });
    await expect(fetchVaultAnyProAccess("user-a", client)).resolves.toBe(true);
  });

  it("preserves the legacy club is_pro fallback", async () => {
    const { client, calls } = scriptedClient({
      user_roles: [{ data: [{ club_id: "club-a", team_id: null }], error: null }],
      club_subscriptions: [{ data: [], error: null }],
      clubs: [{ data: [{ is_pro: true }], error: null }],
    });
    await expect(fetchVaultAnyProAccess("user-a", client)).resolves.toBe(true);
    expect(calls).toContainEqual({ table: "clubs", method: "eq", args: ["is_pro", true] });
  });

  it("fails closed without any role scope", async () => {
    const { client, calls } = scriptedClient({ user_roles: [{ data: [], error: null }] });
    await expect(fetchVaultAnyProAccess("user-a", client)).resolves.toBe(false);
    expect(calls.every((call) => call.table === "user_roles")).toBe(true);
  });
});
