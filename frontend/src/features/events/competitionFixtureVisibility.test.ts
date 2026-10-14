import { describe, expect, it } from "vitest";
import { fetchViewableCompetitionMatchIds, makeCompetitionFixtureVisibility } from "./competitionFixtureVisibility";

describe("fetchViewableCompetitionMatchIds", () => {
  it("uses the caller-scoped RPC rather than client-supplied role lists", async () => {
    const rpc = async (name: string) => ({
      data: [{ match_id: "match-1" }],
      error: name === "get_my_viewable_competition_match_ids" ? null : new Error("unexpected RPC"),
    });

    await expect(fetchViewableCompetitionMatchIds({ rpc })).resolves.toEqual(["match-1"]);
  });

  it("fails closed when the scope RPC returns an error", async () => {
    const failure = new Error("denied");
    const rpc = async () => ({ data: null, error: failure });
    await expect(fetchViewableCompetitionMatchIds({ rpc })).rejects.toBe(failure);
  });
});

describe("makeCompetitionFixtureVisibility", () => {
  it("keeps own-team events and adds a single read-only copy of other competition fixtures", () => {
    const events = [
      { id: "own-copy", team_id: "team-1", competition_match_id: "match-1" },
      { id: "other-copy-a", team_id: "team-2", competition_match_id: "match-1" },
      { id: "other-copy-b", team_id: "team-3", competition_match_id: "match-1" },
      { id: "unrelated", team_id: "team-4", competition_match_id: "match-2" },
    ];
    const visible = makeCompetitionFixtureVisibility(["team-1"], ["match-1"], events);

    expect(events.filter(visible).map((event) => event.id)).toEqual([
      "own-copy",
    ]);
  });

  it("shows one eligible opponent-team copy when the viewer has no own-team copy", () => {
    const events = [
      { id: "home-copy", team_id: "team-1", competition_match_id: "match-1" },
      { id: "away-copy", team_id: "team-2", competition_match_id: "match-1" },
      { id: "duplicate-copy", team_id: "team-3", competition_match_id: "match-1" },
      { id: "other-match", team_id: "team-4", competition_match_id: "match-2" },
    ];
    const visible = makeCompetitionFixtureVisibility([], ["match-1"], events);

    expect(events.filter(visible).map((event) => event.id)).toEqual([
      "home-copy",
    ]);
  });

  it("does not expose competition fixtures outside the computed match scope", () => {
    const visible = makeCompetitionFixtureVisibility([], [], [
      { id: "fixture", team_id: "team-1", competition_match_id: "match-1" },
    ]);
    expect(visible({ id: "fixture", team_id: "team-1", competition_match_id: "match-1" })).toBe(false);
  });
});