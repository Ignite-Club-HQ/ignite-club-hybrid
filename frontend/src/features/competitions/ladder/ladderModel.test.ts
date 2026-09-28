import { describe, expect, it } from "vitest";
import type { CompetitionDivisionSummary } from "../fixtures/types";
import {
  addAcceptedEntryPlaceholders,
  buildLadderDivisionOptions,
  buildLadderTeamOptions,
  collectLadderTeamIds,
  enrichLadderRows,
  filterLadderRows,
  groupLadderRows,
  normalizeLadderTeamFilter,
  visibleLadderRows,
} from "./ladderModel";
import type { CompetitionLadderRow } from "./types";

function row(teamId: string, divisionId: string | null, overrides: Partial<CompetitionLadderRow> = {}): CompetitionLadderRow {
  return {
    competition_id: "competition-1",
    team_id: teamId,
    division_id: divisionId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_diff: 0,
    points: 0,
    ...overrides,
  };
}

const divisions: CompetitionDivisionSummary[] = [
  { id: "division-a", name: "U10" },
  { id: "division-b", name: "U12", hide_ladder: true },
];

describe("ladder row construction", () => {
  it("adds one zero placeholder for each accepted team/division without a ladder row", () => {
    const existing = row("team-1", "division-a", { played: 1, points: 3 });
    const result = addAcceptedEntryPlaceholders("competition-1", [existing], [
      { team_id: "team-1", division_id: "division-a", status: "accepted" },
      { team_id: "team-2", division_id: "division-a", status: "accepted" },
      { team_id: "team-2", division_id: "division-a", status: "accepted" },
      { team_id: null, division_id: "division-a", status: "accepted" },
    ]);
    expect(result).toEqual([
      existing,
      row("team-2", "division-a"),
    ]);
  });

  it("collects unique team ids and enriches every row without dropping missing teams", () => {
    const rows = [row("team-1", null), row("team-1", "division-a"), row("team-2", null)];
    expect(collectLadderTeamIds(rows)).toEqual(["team-1", "team-2"]);
    expect(enrichLadderRows(rows, [{ id: "team-1", name: "Riverside" }]).map((item) => item.teams))
      .toEqual([
        { id: "team-1", name: "Riverside" },
        { id: "team-1", name: "Riverside" },
        null,
      ]);
  });
});

describe("ladder visibility and filters", () => {
  const rows = [
    row("team-1", "division-a", { teams: { id: "team-1", name: "Riverside" } }),
    row("team-2", "division-a", { teams: { id: "team-2", name: "Hilltown" } }),
    row("team-1", "division-b", { teams: { id: "team-1", name: "Riverside" } }),
    row("team-3", "division-b", { teams: { id: "team-3", name: "Lakeside" } }),
  ];

  it("shows all rows to admins but hides the entire ladder from members when any division is hidden", () => {
    expect(visibleLadderRows(rows, divisions, true)).toBe(rows);
    expect(visibleLadderRows(rows, divisions, false)).toEqual([]);
    expect(visibleLadderRows(rows, divisions.map((division) => ({ ...division, hide_ladder: false })), false))
      .toBe(rows);
  });

  it("keeps division options in configured order and team options alphabetized", () => {
    expect(buildLadderDivisionOptions(rows, divisions).map((division) => division.id))
      .toEqual(["division-a", "division-b"]);
    expect(buildLadderTeamOptions(rows, "division-a")).toEqual([
      { id: "team-2", name: "Hilltown" },
      { id: "team-1", name: "Riverside" },
    ]);
  });

  it("resets unavailable teams and keeps every row in a selected team's participating divisions", () => {
    const options = buildLadderTeamOptions(rows, "division-a");
    expect(normalizeLadderTeamFilter("team-3", options)).toBe("_all");
    expect(normalizeLadderTeamFilter("team-1", options)).toBe("team-1");
    expect(filterLadderRows(rows, "_all", "team-1").map((item) => item.team_id))
      .toEqual(["team-1", "team-2", "team-1", "team-3"]);
    expect(filterLadderRows(rows, "division-a", "team-1").map((item) => item.team_id))
      .toEqual(["team-1", "team-2"]);
  });
});

describe("ladder grouping", () => {
  it("prefers played overall data over an empty single-division placeholder and re-ranks", () => {
    const overall = row("team-1", null, { played: 2, points: 6, goal_diff: 3, teams: { id: "team-1", name: "Riverside" } });
    const groups = groupLadderRows([
      row("team-2", "division-a", { played: 1, points: 3 }),
      row("team-1", "division-a"),
      overall,
    ], [divisions[0]]);
    expect(groups).toHaveLength(1);
    expect(groups[0].divisionId).toBe("division-a");
    expect(groups[0].rows.map((item) => [item.team_id, item.points, item.division_id]))
      .toEqual([
        ["team-1", 6, "division-a"],
        ["team-2", 3, "division-a"],
      ]);
  });

  it("keeps divisional data when it has played matches and groups multiple divisions in first-seen order", () => {
    const single = groupLadderRows([
      row("team-1", "division-a", { played: 1, points: 3 }),
      row("team-1", null, { played: 2, points: 6 }),
    ], [divisions[0]]);
    expect(single[0].rows[0].points).toBe(3);

    const multiple = groupLadderRows([
      row("team-3", "division-b"),
      row("team-1", "division-a"),
      row("team-2", "division-b"),
    ], divisions);
    expect(multiple.map((group) => [group.divisionId, group.rows.map((item) => item.team_id)]))
      .toEqual([
        ["division-b", ["team-3", "team-2"]],
        ["division-a", ["team-1"]],
      ]);
  });
});
