import { describe, expect, it, vi } from "vitest";
import {
  fetchCanManageEvent,
  fetchEventProAccess,
  fetchEventProFootballAccess,
  fetchIsAppAdmin,
} from "./eventAccessRepository";

function clientWith(results: any[]) {
  const queries: any[] = [];
  const from = vi.fn((table: string) => {
    const result = results.shift() ?? { data: null, error: null };
    const filters: any[] = [];
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query; }),
      in: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query; }),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    queries.push({ table, query, filters });
    return query;
  });
  return { client: { from }, queries };
}

describe("event access repository", () => {
  it("checks app-admin identity exactly and fails closed for missing data", async () => {
    const yes = clientWith([{ data: { id: "role-1" } }]);
    await expect(fetchIsAppAdmin(yes.client, "user-1")).resolves.toBe(true);
    expect(yes.queries[0].filters).toEqual([
      ["user_id", "user-1"], ["role", "app_admin"],
    ]);
    await expect(fetchIsAppAdmin(clientWith([{ data: null }]).client, "user-1"))
      .resolves.toBe(false);
  });

  it("allows club managers without issuing narrower scope queries", async () => {
    const setup = clientWith([{ data: [{ role: "committee_member" }] }]);
    await expect(fetchCanManageEvent(setup.client, "user-1", {
      clubId: "club-1", teamId: "team-1", miniLeagueId: "league-1",
    })).resolves.toBe(true);
    expect(setup.client.from).toHaveBeenCalledTimes(1);
  });

  it("checks team then mini-league roles only for their exact event scopes", async () => {
    const setup = clientWith([
      { data: [] }, { data: [{ role: "player" }] }, { data: [{ role: "league_admin" }] },
    ]);
    await expect(fetchCanManageEvent(setup.client, "user-1", {
      clubId: "club-1", teamId: "team-1", miniLeagueId: "league-1",
    })).resolves.toBe(true);
    expect(setup.queries[1].filters).toContainEqual(["team_id", "team-1"]);
    expect(setup.queries[2].filters).toContainEqual(["club_id", "club-1"]);
  });

  it("fails closed for unrelated or unavailable manager roles", async () => {
    const setup = clientWith([{ data: null }, { data: [{ role: "parent" }] }]);
    await expect(fetchCanManageEvent(setup.client, "user-1", {
      clubId: "club-1", teamId: "team-1",
    })).resolves.toBe(false);
  });

  it("resolves football access from team first, then exact club fallback", async () => {
    const team = clientWith([{ data: { admin_pro_football_override: true } }]);
    await expect(fetchEventProFootballAccess(team.client, "team-1", "club-1"))
      .resolves.toBe(true);
    expect(team.client.from).toHaveBeenCalledTimes(1);

    const club = clientWith([
      { data: null }, { data: { is_pro_football: true } },
    ]);
    await expect(fetchEventProFootballAccess(club.client, "team-1", "club-1"))
      .resolves.toBe(true);
    expect(club.queries[1].filters).toContainEqual(["club_id", "club-1"]);
  });

  it("recognizes all Pro flags and fails closed when neither scope is entitled", async () => {
    for (const flag of [
      "is_pro", "is_pro_football", "admin_pro_override", "admin_pro_football_override",
    ]) {
      await expect(fetchEventProAccess(
        clientWith([{ data: { [flag]: true } }]).client,
        "team-1",
        "club-1",
      )).resolves.toBe(true);
    }
    await expect(fetchEventProAccess(
      clientWith([{ data: null }, { data: null }]).client,
      "team-1",
      "club-1",
    )).resolves.toBe(false);
  });
});
