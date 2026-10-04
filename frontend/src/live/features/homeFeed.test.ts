import { describe, expect, it } from "vitest";
import {
  deriveLiveMemberships,
  mapLiveHomeEvent,
  type LiveRoleGrantLike,
} from "./homeFeed";

const grant = (
  role: string,
  club: string | null,
  team: string | null,
): LiveRoleGrantLike => ({
  role,
  club: club ? [club] : [],
  team: team ? [team] : [],
});

describe("deriveLiveMemberships", () => {
  it("collects club and team ids and maps grants to the HomePage roles shape", () => {
    const result = deriveLiveMemberships([
      grant("player", "club-1", "team-1"),
      grant("parent", "club-1", null),
      grant("coach", "club-2", "team-9"),
    ]);
    expect(result.clubIds.sort()).toEqual(["club-1", "club-2"]);
    expect(result.teamIds.sort()).toEqual(["team-1", "team-9"]);
    expect(result.roles).toContainEqual({ role: "player", club_id: "club-1", team_id: "team-1" });
    expect(result.roles).toContainEqual({ role: "parent", club_id: "club-1", team_id: null });
  });

  it("marks club_admin and app_admin clubs as admin clubs", () => {
    const result = deriveLiveMemberships([
      grant("club_admin", "club-1", null),
      grant("app_admin", "club-2", null),
      grant("player", "club-3", null),
    ]);
    expect(result.clubAdminClubIds.sort()).toEqual(["club-1", "club-2"]);
  });

  it("tracks league admin clubs but leaves mini-leagues empty (Supabase-only)", () => {
    const result = deriveLiveMemberships([grant("league_admin", "club-1", null)]);
    expect(result.leagueAdminClubIds).toEqual(["club-1"]);
    expect(result.miniLeagueIds).toEqual([]);
  });

  it("returns empty memberships for no grants", () => {
    const result = deriveLiveMemberships([]);
    expect(result.clubIds).toEqual([]);
    expect(result.teamIds).toEqual([]);
    expect(result.roles).toEqual([]);
  });
});

describe("mapLiveHomeEvent", () => {
  const canisterEvent = {
    id: "evt-1",
    title: "Saturday training",
    description: "",
    event_type: "training",
    location: [] as [] | [string],
    cancelled: false,
    club_id: "club-1",
    team_id: ["team-1"] as [] | [string],
    creator: { toText: () => "aaaaa-aa" } as never,
    deleted: false,
    series_id: [] as [] | [string],
    starts_at_ms: BigInt(1_800_000_000_000),
    ends_at_ms: BigInt(1_800_003_600_000),
    revision: BigInt(3),
    opponent: [] as [] | [string],
    address: [] as [] | [string],
    mini_league_id: [] as [] | [string],
    updated_at_ms: BigInt(1_800_000_000_000),
  };

  it("maps the canister event to the HomePage Event shape", () => {
    const mapped = mapLiveHomeEvent(canisterEvent, new Map([["club-1", "Ignite FC"]]));
    expect(mapped.id).toBe("evt-1");
    expect(mapped.title).toBe("Saturday training");
    expect(mapped.club_id).toBe("club-1");
    expect(mapped.team_id).toBe("team-1");
    expect(mapped.clubs).toEqual({ name: "Ignite FC", sport: null });
    expect(mapped.event_date).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it("maps canister type, location, and cancellation through", () => {
    const mapped = mapLiveHomeEvent(
      { ...canisterEvent, event_type: "game", location: ["Riverside Oval"], cancelled: true },
      new Map(),
    );
    expect(mapped.type).toBe("game");
    expect(mapped.location_name).toBe("Riverside Oval");
    expect(mapped.is_cancelled).toBe(true);
  });

  it("maps the mini_league type to social (HomePage union has no mini_league)", () => {
    const mapped = mapLiveHomeEvent({ ...canisterEvent, event_type: "mini_league" }, new Map());
    expect(mapped.type).toBe("training");
  });

  it("handles missing team, club profile, and provisional fields", () => {
    const mapped = mapLiveHomeEvent({ ...canisterEvent, team_id: [] }, new Map());
    expect(mapped.team_id).toBeNull();
    expect(mapped.clubs).toEqual({ name: "", sport: null });
    expect(mapped.teams).toBeNull();
    expect(mapped.is_cancelled).toBe(false);
    expect(mapped.is_recurring).toBe(false);
    expect(mapped.type).toBe("training");
  });
});
