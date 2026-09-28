import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchVaultClubTeams,
  fetchVaultMiniLeagues,
  fetchVaultTeamFolders,
  resolveVaultFolderDeepLink,
  resolveVaultScopeDeepLink,
} from "./vaultNavigationRepository";

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
    for (const method of ["select", "eq", "in", "is", "order"]) query[method] = record(method);
    const take = () => script[table]?.shift() ?? { data: null, error: null };
    query.maybeSingle = async () => take();
    query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, calls };
}

describe("Vault navigation repository", () => {
  it("resolves a nested team-folder link with ordered breadcrumbs and club context", async () => {
    const { client } = scriptedClient({
      vault_folders: [
        { data: {
          id: "child", name: "Match Reports", parent_id: "parent", team_id: "team-a", club_id: "club-a",
          teams: { id: "team-a", name: "U10 Blue", club_id: "club-a" }, clubs: null,
        }, error: null },
        { data: { id: "parent", name: "Season 2026", parent_id: null }, error: null },
      ],
      clubs: [{ data: { name: "Synthetic Club" }, error: null }],
    });
    await expect(resolveVaultFolderDeepLink("child", client)).resolves.toEqual({
      path: [{ id: "parent", name: "Season 2026" }, { id: "child", name: "Match Reports" }],
      view: {
        type: "team", clubId: "club-a", clubName: "Synthetic Club",
        teamId: "team-a", teamName: "U10 Blue", folderId: "child", folderName: "Match Reports",
      },
    });
  });

  it("fails closed when a folder link cannot be read", async () => {
    const { client } = scriptedClient({ vault_folders: [{ data: null, error: { message: "denied" } }] });
    await expect(resolveVaultFolderDeepLink("hidden", client)).resolves.toBeNull();
  });

  it("resolves team and mini-league links only inside accessible clubs", async () => {
    const clubs = [{ id: "club-a", name: "Synthetic Club" }];
    const teamClient = scriptedClient({
      teams: [{ data: { id: "team-a", name: "U10 Blue", club_id: "club-a" }, error: null }],
    }).client;
    await expect(resolveVaultScopeDeepLink({
      clubId: null, teamId: "team-a", miniLeagueId: null, accessibleClubs: clubs,
    }, teamClient)).resolves.toMatchObject({ type: "team", clubId: "club-a", teamId: "team-a" });

    const hiddenLeagueClient = scriptedClient({
      mini_leagues: [{ data: { id: "league-b", name: "Hidden", club_id: "club-b" }, error: null }],
    }).client;
    await expect(resolveVaultScopeDeepLink({
      clubId: null, teamId: null, miniLeagueId: "league-b", accessibleClubs: clubs,
    }, hiddenLeagueClient)).resolves.toBeNull();
  });

  it("fails closed when a team or mini-league row has no club scope", async () => {
    const clubs = [{ id: "club-a", name: "Synthetic Club" }];
    const teamClient = scriptedClient({
      teams: [{ data: { id: "team-a", name: "Orphan Team", club_id: null }, error: null }],
    }).client;
    await expect(resolveVaultScopeDeepLink({
      clubId: null, teamId: "team-a", miniLeagueId: null, accessibleClubs: clubs,
    }, teamClient)).resolves.toBeNull();

    const leagueClient = scriptedClient({
      mini_leagues: [{ data: { id: "league-a", name: "Orphan League", club_id: null }, error: null }],
    }).client;
    await expect(resolveVaultScopeDeepLink({
      clubId: null, teamId: null, miniLeagueId: "league-a", accessibleClubs: clubs,
    }, leagueClient)).resolves.toBeNull();
  });

  it("returns all non-deleted club teams for an admin when the club has Pro", async () => {
    const teams = [{ id: "team-a", name: "U10 Blue", folder_id: null }];
    const { client, calls } = scriptedClient({ teams: [{ data: teams, error: null }] });
    await expect(fetchVaultClubTeams({
      clubId: "club-a", isClubAdmin: true, userTeamIds: [], clubHasPro: true,
    }, client)).resolves.toEqual(teams);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "teams", method: "eq", args: ["club_id", "club-a"] },
      { table: "teams", method: "is", args: ["deleted_at", null] },
      { table: "teams", method: "order", args: ["name"] },
    ]));
    expect(calls.some((call) => call.table === "team_subscriptions")).toBe(false);
  });

  it("limits non-admins to assigned teams with their own Pro entitlement", async () => {
    const { client, calls } = scriptedClient({
      teams: [{ data: [
        { id: "team-a", name: "A", folder_id: null },
        { id: "team-b", name: "B", folder_id: null },
      ], error: null }],
      team_subscriptions: [{ data: [
        { team_id: "team-a", is_pro: false },
        { team_id: "team-b", admin_pro_override: true },
      ], error: null }],
    });
    await expect(fetchVaultClubTeams({
      clubId: "club-a",
      isClubAdmin: false,
      userTeamIds: ["team-a", "team-b"],
      clubHasPro: false,
    }, client)).resolves.toEqual([{ id: "team-b", name: "B", folder_id: null }]);
    expect(calls).toContainEqual({ table: "teams", method: "in", args: ["id", ["team-a", "team-b"]] });
  });

  it("does not query teams when a non-admin has no assigned team", async () => {
    const { client, calls } = scriptedClient({});
    await expect(fetchVaultClubTeams({
      clubId: "club-a", isClubAdmin: false, userTeamIds: [], clubHasPro: false,
    }, client)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it("loads ordered team folders for only the selected club", async () => {
    const folders = [{ id: "folder-a", club_id: "club-a", name: "Juniors" }];
    const { client, calls } = scriptedClient({ team_folders: [{ data: folders, error: null }] });
    await expect(fetchVaultTeamFolders("club-a", client)).resolves.toEqual(folders);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "team_folders", method: "eq", args: ["club_id", "club-a"] },
      { table: "team_folders", method: "order", args: ["sort_order", { ascending: true }] },
    ]));
  });

  it("fails closed for mini leagues without Pro Football", async () => {
    const { client, calls } = scriptedClient({
      user_roles: [{ data: [{ role: "club_admin", club_id: "club-a" }], error: null }],
      club_subscriptions: [{ data: { is_pro_football: false }, error: null }],
    });
    await expect(fetchVaultMiniLeagues({
      clubId: "club-a", userId: "user-a", isAppAdmin: false,
    }, client)).resolves.toEqual([]);
    expect(calls.some((call) => call.table === "mini_leagues")).toBe(false);
  });

  it("lets privileged club roles see every ordered league in that club", async () => {
    const leagues = [{ id: "league-a", name: "U8 Mini League" }];
    const { client, calls } = scriptedClient({
      user_roles: [{ data: [{ role: "committee_member", club_id: "club-a" }], error: null }],
      club_subscriptions: [{ data: { is_pro_football: true }, error: null }],
      mini_leagues: [{ data: leagues, error: null }],
    });
    await expect(fetchVaultMiniLeagues({
      clubId: "club-a", userId: "user-a", isAppAdmin: false,
    }, client)).resolves.toEqual(leagues);
    expect(calls).toContainEqual({ table: "mini_leagues", method: "eq", args: ["club_id", "club-a"] });
  });

  it("filters a parent's joined mini leagues back to the selected club", async () => {
    const { client } = scriptedClient({
      user_roles: [{ data: [{ role: "parent", club_id: "club-a" }], error: null }],
      club_subscriptions: [{ data: { admin_pro_football_override: true }, error: null }],
      mini_league_players: [{ data: [
        { mini_leagues: { id: "league-a", name: "A", club_id: "club-a" } },
        { mini_leagues: { id: "league-b", name: "B", club_id: "club-b" } },
      ], error: null }],
    });
    await expect(fetchVaultMiniLeagues({
      clubId: "club-a", userId: "parent-a", isAppAdmin: false,
    }, client)).resolves.toEqual([{ id: "league-a", name: "A" }]);
  });
});
