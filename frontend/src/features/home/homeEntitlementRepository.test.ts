import { describe, expect, it, vi } from "vitest";
import {
  fetchHomeProAccess,
  fetchHomeRewardClubs,
} from "./homeEntitlementRepository";

type Result = { data: any; error?: unknown };

function query(result: Result) {
  const builder: any = {
    select: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  builder.select.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.single.mockResolvedValue(result);
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

function clientFor(results: Record<string, Result | Result[]>) {
  const calls = new Map<string, number>();
  const builders: Record<string, any[]> = {};
  const from = vi.fn((table: string) => {
    const configured = results[table];
    const sequence = Array.isArray(configured) ? configured : [configured ?? { data: [] }];
    const index = calls.get(table) ?? 0;
    calls.set(table, index + 1);
    const builder = query(sequence[Math.min(index, sequence.length - 1)]);
    (builders[table] ??= []).push(builder);
    return builder;
  });
  return { client: { from }, from, builders };
}

describe("fetchHomeProAccess", () => {
  it("returns false without querying when the user has no club or team scope", async () => {
    const { client, from } = clientFor({});
    await expect(fetchHomeProAccess(client, [], [])).resolves.toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts every supported club and team Pro entitlement flag", async () => {
    for (const flag of [
      "is_pro",
      "is_pro_football",
      "admin_pro_override",
      "admin_pro_football_override",
    ]) {
      const { client } = clientFor({
        club_subscriptions: { data: [{ club_id: "club-1", [flag]: true }] },
        team_subscriptions: { data: [] },
        teams: { data: [] },
      });
      await expect(fetchHomeProAccess(client, ["club-1"], ["team-1"])).resolves.toBe(true);
    }
  });

  it("retains the legacy teams.is_pro trial fallback", async () => {
    const { client } = clientFor({
      club_subscriptions: { data: [] },
      team_subscriptions: { data: [] },
      teams: { data: [{ id: "team-1", is_pro: true }] },
    });
    await expect(fetchHomeProAccess(client, ["club-1"], ["team-1"])).resolves.toBe(true);
  });

  it("fails closed when subscription reads return no data", async () => {
    const { client } = clientFor({
      club_subscriptions: { data: null, error: new Error("unavailable") },
      team_subscriptions: { data: null },
      teams: { data: null },
    });
    await expect(fetchHomeProAccess(client, ["club-1"], ["team-1"])).resolves.toBe(false);
  });
});

describe("fetchHomeRewardClubs", () => {
  it("scopes an active-club view to that club and its subscription", async () => {
    const { client, builders } = clientFor({
      clubs: { data: { id: "club-2", name: "Riverside", logo_url: null } },
      club_subscriptions: { data: { club_id: "club-2", admin_pro_override: true } },
    });

    await expect(fetchHomeRewardClubs(client, ["club-1", "club-2"], "club-2")).resolves.toEqual([
      { id: "club-2", name: "Riverside", logo_url: null, hasPro: true },
    ]);
    expect(builders.clubs[0].eq).toHaveBeenCalledWith("id", "club-2");
    expect(builders.club_subscriptions[0].eq).toHaveBeenCalledWith("club_id", "club-2");
  });

  it("maps only membership clubs and their exact subscription status", async () => {
    const { client, builders } = clientFor({
      clubs: { data: [{ id: "club-1", name: "One", logo_url: null }, { id: "club-2", name: "Two", logo_url: null }] },
      club_subscriptions: { data: [{ club_id: "club-2", is_pro_football: true }] },
    });

    await expect(fetchHomeRewardClubs(client, ["club-1", "club-2"], null)).resolves.toEqual([
      { id: "club-1", name: "One", logo_url: null, hasPro: false },
      { id: "club-2", name: "Two", logo_url: null, hasPro: true },
    ]);
    expect(builders.clubs[0].in).toHaveBeenCalledWith("id", ["club-1", "club-2"]);
    expect(builders.club_subscriptions[0].in).toHaveBeenCalledWith("club_id", ["club-1", "club-2"]);
  });
});
