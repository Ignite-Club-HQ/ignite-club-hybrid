import type { CompetitionDivisionSummary } from "../fixtures/types";
import type {
  AcceptedCompetitionEntry,
  CompetitionLadderRow,
  CompetitionLadderTeam,
  LadderFilterOption,
  LadderGroup,
} from "./types";

export const ALL_LADDER_FILTER = "_all";
const OVERALL_DIVISION_KEY = "__none";

function ladderKey(teamId: string | null, divisionId: string | null): string {
  return `${teamId ?? ""}::${divisionId ?? ""}`;
}

export function addAcceptedEntryPlaceholders(
  competitionId: string,
  ladderRows: CompetitionLadderRow[],
  entries: AcceptedCompetitionEntry[],
): CompetitionLadderRow[] {
  const seen = new Set(
    ladderRows.map((row) => ladderKey(row.team_id, row.division_id)),
  );
  const placeholders: CompetitionLadderRow[] = [];
  for (const entry of entries) {
    const key = ladderKey(entry.team_id, entry.division_id);
    if (!entry.team_id || seen.has(key)) continue;
    seen.add(key);
    placeholders.push({
      competition_id: competitionId,
      team_id: entry.team_id,
      division_id: entry.division_id,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_diff: 0,
      points: 0,
    });
  }
  return [...ladderRows, ...placeholders];
}

export function collectLadderTeamIds(rows: CompetitionLadderRow[]): string[] {
  return Array.from(new Set(
    rows.map((row) => row.team_id).filter((teamId): teamId is string => Boolean(teamId)),
  ));
}

export function enrichLadderRows(
  rows: CompetitionLadderRow[],
  teams: CompetitionLadderTeam[],
): CompetitionLadderRow[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  return rows.map((row) => ({
    ...row,
    teams: row.team_id ? teamsById.get(row.team_id) ?? null : null,
  }));
}

export function visibleLadderRows(
  rows: CompetitionLadderRow[],
  divisions: CompetitionDivisionSummary[],
  isAdmin: boolean,
): CompetitionLadderRow[] {
  if (isAdmin) return rows;
  return divisions.some((division) => division.hide_ladder) ? [] : rows;
}

export function buildLadderDivisionOptions(
  rows: CompetitionLadderRow[],
  divisions: CompetitionDivisionSummary[],
): CompetitionDivisionSummary[] {
  const presentIds = new Set(
    rows.map((row) => row.division_id).filter((id): id is string => Boolean(id)),
  );
  return divisions.filter((division) => presentIds.has(division.id));
}

export function buildLadderTeamOptions(
  rows: CompetitionLadderRow[],
  divisionId: string,
): LadderFilterOption[] {
  const options = new Map<string, string>();
  for (const row of rows) {
    if (divisionId !== ALL_LADDER_FILTER && row.division_id !== divisionId) continue;
    if (row.team_id) options.set(row.team_id, row.teams?.name ?? "?");
  }
  return Array.from(options, ([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeLadderTeamFilter(
  selectedTeamId: string,
  options: LadderFilterOption[],
): string {
  if (
    selectedTeamId !== ALL_LADDER_FILTER &&
    !options.some((option) => option.id === selectedTeamId)
  ) return ALL_LADDER_FILTER;
  return selectedTeamId;
}

export function filterLadderRows(
  rows: CompetitionLadderRow[],
  divisionId: string,
  teamId: string,
): CompetitionLadderRow[] {
  const teamDivisionKeys = teamId === ALL_LADDER_FILTER
    ? null
    : new Set(
      rows
        .filter((row) => row.team_id === teamId)
        .map((row) => row.division_id ?? OVERALL_DIVISION_KEY),
    );
  return rows.filter((row) => {
    if (divisionId !== ALL_LADDER_FILTER && row.division_id !== divisionId) return false;
    if (
      teamDivisionKeys &&
      !teamDivisionKeys.has(row.division_id ?? OVERALL_DIVISION_KEY)
    ) return false;
    return true;
  });
}

function rankRows(rows: CompetitionLadderRow[]): CompetitionLadderRow[] {
  return [...rows].sort((left, right) =>
    (right.points ?? 0) - (left.points ?? 0) ||
    (right.goal_diff ?? 0) - (left.goal_diff ?? 0) ||
    (right.goals_for ?? 0) - (left.goals_for ?? 0)
  );
}

export function groupLadderRows(
  filteredRows: CompetitionLadderRow[],
  divisionOptions: CompetitionDivisionSummary[],
): LadderGroup[] {
  if (divisionOptions.length <= 1) {
    const overallRows = filteredRows.filter((row) => !row.division_id);
    const divisionRows = filteredRows.filter((row) => row.division_id);
    if (divisionRows.length > 0) {
      const overallByTeam = new Map(overallRows.map((row) => [row.team_id, row]));
      const merged = divisionRows.map((row) => {
        const overall = overallByTeam.get(row.team_id);
        if (!overall) return row;
        const hasDivisionData = (row.played ?? 0) > 0;
        const hasOverallData = (overall.played ?? 0) > 0;
        if (hasOverallData && !hasDivisionData) {
          return {
            ...overall,
            division_id: row.division_id,
            teams: row.teams ?? overall.teams,
          };
        }
        return row;
      });
      return [{ divisionId: divisionRows[0].division_id!, rows: rankRows(merged) }];
    }
    return overallRows.length > 0
      ? [{ divisionId: OVERALL_DIVISION_KEY, rows: overallRows }]
      : [];
  }

  const groups = new Map<string, CompetitionLadderRow[]>();
  for (const row of filteredRows) {
    const key = row.division_id ?? OVERALL_DIVISION_KEY;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups, ([divisionId, rows]) => ({ divisionId, rows }));
}
