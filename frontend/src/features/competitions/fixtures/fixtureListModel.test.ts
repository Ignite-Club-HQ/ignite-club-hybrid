import { describe, expect, it } from "vitest";
import type { CompetitionFixtureRow, LinkedCompetitionTeam } from "./types";
import {
  ALL_FIXTURES_FILTER,
  buildFixtureClubOptions,
  buildFixtureTeamOptions,
  collectExternalTeamIds,
  filterCompetitionFixtures,
  groupFixturesByRound,
  mapClubsByExternalTeam,
  normalizeFixtureFilter,
  summarizeFixtureRounds,
} from "./fixtureListModel";

function fixture(
  id: string,
  overrides: Partial<CompetitionFixtureRow> = {},
): CompetitionFixtureRow {
  return {
    id,
    competition_id: "competition-1",
    division_id: "division-a",
    round_number: 1,
    home_team_id: "home-local",
    away_team_id: "away-local",
    home: { id: "home-local", name: "Riverside" },
    away: { id: "away-local", name: "Hilltown" },
    ...overrides,
  };
}

const linkedTeams: LinkedCompetitionTeam[] = [
  {
    id: "ignite-home",
    name: "Riverside",
    playhq_team_id: "external-home",
    club_id: "club-riverside",
    clubs: { id: "club-riverside", name: "Riverside FC" },
  },
  {
    id: "ignite-away",
    name: "Hilltown",
    playhq_team_id: "external-away",
    club_id: "club-hilltown",
    clubs: { id: "club-hilltown", name: "Hilltown FC" },
  },
];

describe("fixture-list external linkage", () => {
  it("collects unique external ids in first-seen order", () => {
    expect(collectExternalTeamIds([
      fixture("one", { external_home_team_id: "external-home", external_away_team_id: "external-away" }),
      fixture("two", { external_home_team_id: "external-away", external_away_team_id: "external-third" }),
    ])).toEqual(["external-home", "external-away", "external-third"]);
  });

  it("maps only complete external-team club links", () => {
    const clubs = mapClubsByExternalTeam([
      ...linkedTeams,
      { id: "incomplete", name: "Unknown", playhq_team_id: "external-third", clubs: null },
    ]);
    expect(Array.from(clubs.entries())).toEqual([
      ["external-home", { clubId: "club-riverside", clubName: "Riverside FC" }],
      ["external-away", { clubId: "club-hilltown", clubName: "Hilltown FC" }],
    ]);
  });
});

describe("fixture-list options", () => {
  const matches = [
    fixture("local"),
    fixture("external", {
      division_id: "division-b",
      home_team_id: null,
      away_team_id: null,
      home: null,
      away: null,
      external_home_team_id: "external-home",
      external_away_team_id: "external-unknown",
      home_team_name: "Riverside External",
      away_team_name: null,
    }),
  ];

  it("uses local ids when present and ext-prefixed ids only for external-only teams", () => {
    expect(buildFixtureTeamOptions(matches, ALL_FIXTURES_FILTER)).toEqual([
      { id: "away-local", name: "Hilltown" },
      { id: "ext:external-home", name: "Riverside External" },
      { id: "home-local", name: "Riverside" },
      { id: "ext:external-unknown", name: "Unknown team" },
    ].sort((left, right) => left.name.localeCompare(right.name)));
  });

  it("scopes team and club options to the selected division and deduplicates clubs", () => {
    const clubs = mapClubsByExternalTeam(linkedTeams);
    expect(buildFixtureTeamOptions(matches, "division-a")).toEqual([
      { id: "away-local", name: "Hilltown" },
      { id: "home-local", name: "Riverside" },
    ]);
    expect(buildFixtureClubOptions(matches, "division-b", clubs)).toEqual([
      { id: "club-riverside", name: "Riverside FC" },
    ]);
  });
});

describe("fixture-list filtering", () => {
  const matches = [
    fixture("local-a"),
    fixture("external-b", {
      division_id: "division-b",
      home_team_id: null,
      away_team_id: null,
      home: null,
      away: null,
      external_home_team_id: "external-home",
      external_away_team_id: "external-away",
    }),
  ];
  const clubs = mapClubsByExternalTeam(linkedTeams);

  it.each([
    [{ divisionId: "division-a", teamId: "_all", clubId: "_all" }, ["local-a"]],
    [{ divisionId: "_all", teamId: "home-local", clubId: "_all" }, ["local-a"]],
    [{ divisionId: "_all", teamId: "ext:external-away", clubId: "_all" }, ["external-b"]],
    [{ divisionId: "_all", teamId: "_all", clubId: "club-riverside" }, ["external-b"]],
    [{ divisionId: "division-a", teamId: "_all", clubId: "club-riverside" }, []],
  ])("applies combined filters %o", (filters, expectedIds) => {
    expect(filterCompetitionFixtures(matches, filters, clubs).map((match) => match.id))
      .toEqual(expectedIds);
  });

  it("resets only a selected filter that is no longer available", () => {
    const options = [{ id: "home-local", name: "Riverside" }];
    expect(normalizeFixtureFilter("away-local", options)).toBe("_all");
    expect(normalizeFixtureFilter("home-local", options)).toBe("home-local");
    expect(normalizeFixtureFilter("_all", options)).toBe("_all");
  });
});

describe("fixture-list grouping", () => {
  it("groups by first-seen round while preserving match order and unscheduled fixtures", () => {
    const matches = [
      fixture("round-two-a", { round_number: 2 }),
      fixture("unscheduled", { round_number: null }),
      fixture("round-one", { round_number: 1 }),
      fixture("round-two-b", { round_number: 2 }),
    ];
    expect(groupFixturesByRound(matches).map((group) => ({
      key: group.key,
      label: group.label,
      ids: group.items.map((match) => match.id),
    }))).toEqual([
      { key: "r2", label: "Round 2", ids: ["round-two-a", "round-two-b"] },
      { key: "unscheduled", label: "Other matches", ids: ["unscheduled"] },
      { key: "r1", label: "Round 1", ids: ["round-one"] },
    ]);
    expect(summarizeFixtureRounds(matches)).toEqual({
      roundNumbers: [2, 1],
      totalRounds: 2,
      maximumRound: 2,
    });
  });
});
