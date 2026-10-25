import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchVaultAccessibleClubs,
  fetchVaultAnyProAccess,
  fetchVaultAppAdmin,
  fetchVaultClubHasPro,
  fetchVaultCompetitionAccess,
  fetchVaultTeamHasPro,
  fetchVaultUserRoles,
} from "./vaultAccessRepository";

const accessMocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  isAppAdmin: vi.fn(),
  roles: vi.fn(),
  clubs: vi.fn(),
  team: vi.fn(),
  clubSubscriptions: vi.fn(),
  teamSubscriptions: vi.fn(),
  resolvePro: vi.fn(),
  vaultFolders: vi.fn(),
  competitionAdmin: vi.fn(),
  entitlements: vi.fn(),
  memberIds: vi.fn(),
  scopes: vi.fn(),
  allowance: vi.fn(),
  profile: vi.fn(),
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";
const icpContext = { identity: { getPrincipal: () => ({ toText: () => "principal-a" }) }, target: { alias: "test" } };

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }, scope: unknown) => {
    accessMocks.scopes(scope);
    return accessMocks.backend === "icp" ? providers.icp(icpContext) : providers.supabase();
  },
}));
vi.mock("@/live/features/insights", () => ({ isLiveAppAdmin: (...args: unknown[]) => accessMocks.isAppAdmin(...args) }));
vi.mock("@/live/groupDispatch", () => ({ clubDispatch: { memberClubIds: () => accessMocks.memberIds() } }));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: (...args: unknown[]) => accessMocks.roles(...args) }));
vi.mock("@/live/features/club", () => ({
  listLiveClubs: (...args: unknown[]) => accessMocks.clubs(...args),
  getLiveTeam: (...args: unknown[]) => accessMocks.team(...args),
  getLiveClubProfile: (...args: unknown[]) => accessMocks.profile(...args),
}));
vi.mock("@/live/features/proAccess", () => ({
  listLiveClubSubscriptions: (...args: unknown[]) => accessMocks.clubSubscriptions(...args),
  listLiveTeamSubscriptions: (...args: unknown[]) => accessMocks.teamSubscriptions(...args),
  liveHasAnyPro: (value: unknown) => Boolean(value),
  resolveLiveProAccess: (...args: unknown[]) => accessMocks.resolvePro(...args),
}));
vi.mock("@/live/identityEntitlements", () => ({ fetchIcpEntitlements: (...args: unknown[]) => accessMocks.entitlements(...args) }));
vi.mock("@/live/features/vault", () => ({ listLiveVaultFolders: (...args: unknown[]) => accessMocks.vaultFolders(...args) }));
vi.mock("@/live/features/competitions", () => ({ isLiveCompetitionAdmin: (...args: unknown[]) => accessMocks.competitionAdmin(...args) }));

vi.mock("@/live/crossGroupClubs", () => ({
  readClubsInOwnGroups: async (_ctx: unknown, ids: string[]) => {
    const rows = (await accessMocks.clubs()) as Array<{ id: string; name: string }>;
    return { values: rows.filter(r => ids.includes(r.id)), failed: 0 };
  },
}));
vi.mock("@/live/domains", () => ({ connectLiveClubDomain: async () => ({ actor: { get_media_allowance: accessMocks.allowance } }) }));

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

describe.runIf(supabaseMode)("Vault access repository — Supabase", () => {
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

describe.runIf(!supabaseMode)("Vault access repository — ICP", () => {
  beforeEach(() => {
    accessMocks.backend = "icp";
    for (const mock of Object.values(accessMocks)) {
      if (typeof mock === "function" && "mockReset" in mock) (mock as ReturnType<typeof vi.fn>).mockReset();
    }
    accessMocks.memberIds.mockResolvedValue(["club-a"]);
    accessMocks.allowance.mockResolvedValue({ Ok: { premium: true } });
  });

  it("reads the known selected club directly without an unrelated directory or membership inventory", async () => {
    accessMocks.profile.mockResolvedValue([{ id: "goat", name: "Giddy Goat", deleted_at_ms: [] }]);
    const clubs = await fetchVaultAccessibleClubs("principal-a", true, undefined, "goat");
    expect(clubs).toEqual([{ id: "goat", name: "Giddy Goat", is_pro: true, storage_used_bytes: 0 }]);
    expect(accessMocks.scopes).toHaveBeenCalledWith({ clubId: "goat" });
    expect(accessMocks.clubs).not.toHaveBeenCalled();
    expect(accessMocks.memberIds).not.toHaveBeenCalled();
    expect(accessMocks.allowance).toHaveBeenCalledWith("goat", []);
  });

  it("does not report an unreadable selected club as an empty successful inventory", async () => {
    accessMocks.profile.mockResolvedValue([]);
    await expect(fetchVaultAccessibleClubs("principal-a", false, undefined, "goat")).rejects.toThrow("selected club could not be loaded");
    accessMocks.profile.mockRejectedValue(new Error("Club access temporarily unavailable"));
    await expect(fetchVaultAccessibleClubs("principal-a", false, undefined, "goat")).rejects.toThrow("Club access temporarily unavailable");
  });

  it("maps app-admin and caller role grants from ICP domains", async () => {
    accessMocks.isAppAdmin.mockResolvedValue(true);
    accessMocks.roles.mockResolvedValue([{ role: "coach", club: ["club-a"], team: ["team-a"] }]);
    const { client, calls } = scriptedClient({});
    await expect(fetchVaultAppAdmin("principal-a", client)).resolves.toBe(true);
    await expect(fetchVaultUserRoles("principal-a", client)).resolves.toEqual([
      { role: "coach", club_id: "club-a", team_id: "team-a" },
    ]);
    expect(calls).toEqual([]);
  });

  it("reads selected-club caller roles in that owning group without retaining unrelated grants", async () => {
    accessMocks.roles.mockResolvedValue([
      { role: "club_admin", club: ["club-a"], team: [] },
      { role: "coach", club: ["club-b"], team: ["team-b"] },
    ]);
    expect(await fetchVaultUserRoles("principal-a", undefined, "club-a")).toEqual([
      { role: "club_admin", club_id: "club-a", team_id: null },
    ]);
    expect(accessMocks.scopes).toHaveBeenCalledWith({ clubId: "club-a" });
  });

  it("personal Pro does not mark an unpaid club as paid", async () => {
    accessMocks.clubs.mockResolvedValue([{ id: "club-a", name: "Club A" }]);
    accessMocks.clubSubscriptions.mockResolvedValue(new Map([["club-a", null]]));
    accessMocks.entitlements.mockResolvedValue({ isPro: true });
    const { client, calls } = scriptedClient({});
    await expect(fetchVaultAccessibleClubs("principal-a", false, client)).resolves.toEqual([
      { id: "club-a", name: "Club A", is_pro: false, storage_used_bytes: 0 },
    ]);
    expect(accessMocks.clubSubscriptions).toHaveBeenCalledWith(icpContext, ["club-a"]);
    expect(calls).toEqual([]);
  });

  it("uses ICP Pro resolution for club and team scopes", async () => {
    accessMocks.resolvePro.mockResolvedValue(true);
    accessMocks.team.mockResolvedValue([{ club_id: "club-a" }]);
    const { client, calls } = scriptedClient({});
    await expect(fetchVaultClubHasPro("club-a", client)).resolves.toBe(true);
    await expect(fetchVaultTeamHasPro("team-a", client)).resolves.toBe(true);
    expect(accessMocks.allowance).toHaveBeenCalledWith("club-a", []);
    expect(accessMocks.allowance).toHaveBeenCalledWith("club-a", ["team-a"]);
    expect(calls).toEqual([]);
  });

  it("combines caller club/team grants when resolving any-Pro access", async () => {
    accessMocks.roles.mockResolvedValue([{ club: ["club-a"], team: ["team-a"] }]);
    accessMocks.clubSubscriptions.mockResolvedValue(new Map([["club-a", null]]));
    accessMocks.teamSubscriptions.mockResolvedValue(new Map([["team-a", true]]));
    const { client, calls } = scriptedClient({});
    await expect(fetchVaultAnyProAccess("principal-a", client)).resolves.toBe(true);
    expect(accessMocks.teamSubscriptions).toHaveBeenCalledWith(icpContext, ["team-a"]);
    expect(calls).toEqual([]);
  });

  it("lists only member clubs, reading each club in its own group (no every-group club listing)", async () => {
    accessMocks.clubs.mockResolvedValue([{ id: "club-a", name: "Club A" }, { id: "unrelated", name: "Other Club" }]);
    accessMocks.clubSubscriptions.mockResolvedValue(new Map([["club-a", true]]));
    accessMocks.entitlements.mockResolvedValue({ isPro: false });
    const clubs = await fetchVaultAccessibleClubs("principal-a", false);
    expect(clubs.map(club => club.id)).toEqual(["club-a"]);
    expect(accessMocks.scopes).not.toHaveBeenCalledWith(expect.objectContaining({ everyGroup: true }));
    expect(accessMocks.clubSubscriptions).toHaveBeenCalledWith(icpContext, ["club-a"]);
  });

  it("still lists clubs when the caller's Pro entitlement can't be read", async () => {
    accessMocks.clubs.mockResolvedValue([{ id: "club-a", name: "Club A" }]);
    accessMocks.clubSubscriptions.mockResolvedValue(new Map([["club-a", true]]));
    accessMocks.entitlements.mockRejectedValue(new Error("identity unavailable"));
    const clubs = await fetchVaultAccessibleClubs("principal-a", false);
    expect(clubs.map(club => club.id)).toEqual(["club-a"]);
  });

  it("preserves team lookup failures instead of silently dropping owning club context", async () => {
    accessMocks.team.mockRejectedValue(new Error("Team temporarily unavailable"));
    await expect(fetchVaultTeamHasPro("team-a")).rejects.toThrow("Team temporarily unavailable");
    expect(accessMocks.resolvePro).not.toHaveBeenCalled();
  });

  it("resolves Free when the caller has no role grants or Pro entitlement", async () => {
    accessMocks.roles.mockResolvedValue([]);
    accessMocks.clubSubscriptions.mockResolvedValue(new Map());
    accessMocks.teamSubscriptions.mockResolvedValue(new Map());
    accessMocks.entitlements.mockResolvedValue({ isPro: false });
    const { client, calls } = scriptedClient({});

    await expect(fetchVaultAnyProAccess("principal-a", client)).resolves.toBe(false);

    expect(accessMocks.clubSubscriptions).toHaveBeenCalledWith(icpContext, []);
    expect(accessMocks.teamSubscriptions).toHaveBeenCalledWith(icpContext, []);
    expect(accessMocks.entitlements).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("does not grant club capacity from an unrelated personal Pro purchase", async () => {
    accessMocks.entitlements.mockResolvedValue({ isPro: true });
    accessMocks.allowance.mockResolvedValue({ Ok: { premium: false } });
    await expect(fetchVaultClubHasPro("club-a")).resolves.toBe(false);
    expect(accessMocks.allowance).toHaveBeenCalledWith("club-a", []);
  });

  it("checks competition membership and admin status through ICP domains", async () => {
    accessMocks.vaultFolders.mockResolvedValue([]);
    accessMocks.competitionAdmin.mockResolvedValue(true);
    const { client, calls } = scriptedClient({});
    await expect(fetchVaultCompetitionAccess("competition-a", "principal-a", client))
      .resolves.toEqual({ isMember: true, canManage: true });
    expect(accessMocks.vaultFolders).toHaveBeenCalledWith(icpContext, "", null, null, "competition-a");
    expect(calls).toEqual([]);
  });

  it("preserves competition read failures for retry without reporting denial", async () => {
    accessMocks.vaultFolders.mockRejectedValue(new Error("competition access unavailable"));
    const { client, calls } = scriptedClient({});

    await expect(fetchVaultCompetitionAccess("competition-a", "principal-a", client))
      .rejects.toThrow("competition access unavailable");

    expect(accessMocks.competitionAdmin).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("preserves manager lookup failures rather than falsely denying management", async () => {
    accessMocks.vaultFolders.mockResolvedValue([]);
    accessMocks.competitionAdmin.mockRejectedValue(new Error("manager lookup unavailable"));
    const { client, calls } = scriptedClient({});

    await expect(fetchVaultCompetitionAccess("competition-a", "principal-a", client))
      .rejects.toThrow("manager lookup unavailable");
    expect(calls).toEqual([]);
  });
});
