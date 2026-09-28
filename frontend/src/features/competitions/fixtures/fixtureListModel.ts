import type {
  CompetitionFixtureRow,
  LinkedCompetitionTeam,
} from "./types";

export const ALL_FIXTURES_FILTER = "_all";

export interface FixtureFilterOption {
  id: string;
  name: string;
}

export interface LinkedClubSummary {
  clubId: string;
  clubName: string;
}

export interface FixtureFilters {
  divisionId: string;
  teamId: string;
  clubId: string;
}

export interface FixtureRoundGroup {
  key: string;
  label: string;
  items: CompetitionFixtureRow[];
}

export interface FixtureRoundSummary {
  roundNumbers: number[];
  totalRounds: number;
  maximumRound: number;
}

export function collectExternalTeamIds(matches: CompetitionFixtureRow[]): string[] {
  const ids = new Set<string>();
  for (const match of matches) {
    if (match.external_home_team_id) ids.add(match.external_home_team_id);
    if (match.external_away_team_id) ids.add(match.external_away_team_id);
  }
  return Array.from(ids);
}

export function mapClubsByExternalTeam(
  linkedTeams: LinkedCompetitionTeam[],
): Map<string, LinkedClubSummary> {
  const clubs = new Map<string, LinkedClubSummary>();
  for (const team of linkedTeams) {
    if (team.playhq_team_id && team.clubs?.id) {
      clubs.set(team.playhq_team_id, {
        clubId: team.clubs.id,
        clubName: team.clubs.name,
      });
    }
  }
  return clubs;
}

function isInDivision(match: CompetitionFixtureRow, divisionId: string): boolean {
  return divisionId === ALL_FIXTURES_FILTER || match.division_id === divisionId;
}

export function buildFixtureTeamOptions(
  matches: CompetitionFixtureRow[],
  divisionId: string,
): FixtureFilterOption[] {
  const options = new Map<string, string>();
  for (const match of matches) {
    if (!isInDivision(match, divisionId)) continue;
    if (match.home?.id) {
      options.set(match.home.id, match.home.name);
    } else if (match.external_home_team_id) {
      options.set(
        `ext:${match.external_home_team_id}`,
        match.home_team_name ?? "Unknown team",
      );
    }
    if (match.away?.id) {
      options.set(match.away.id, match.away.name);
    } else if (match.external_away_team_id) {
      options.set(
        `ext:${match.external_away_team_id}`,
        match.away_team_name ?? "Unknown team",
      );
    }
  }
  return Array.from(options, ([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildFixtureClubOptions(
  matches: CompetitionFixtureRow[],
  divisionId: string,
  clubsByExternalTeam: Map<string, LinkedClubSummary>,
): FixtureFilterOption[] {
  const options = new Map<string, string>();
  for (const match of matches) {
    if (!isInDivision(match, divisionId)) continue;
    if (match.external_home_team_id) {
      const club = clubsByExternalTeam.get(match.external_home_team_id);
      if (club) options.set(club.clubId, club.clubName);
    }
    if (match.external_away_team_id) {
      const club = clubsByExternalTeam.get(match.external_away_team_id);
      if (club) options.set(club.clubId, club.clubName);
    }
  }
  return Array.from(options, ([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function filterCompetitionFixtures(
  matches: CompetitionFixtureRow[],
  filters: FixtureFilters,
  clubsByExternalTeam: Map<string, LinkedClubSummary>,
): CompetitionFixtureRow[] {
  return matches.filter((match) => {
    if (!isInDivision(match, filters.divisionId)) return false;
    if (filters.teamId !== ALL_FIXTURES_FILTER) {
      if (filters.teamId.startsWith("ext:")) {
        const externalId = filters.teamId.slice(4);
        if (
          match.external_home_team_id !== externalId &&
          match.external_away_team_id !== externalId
        ) return false;
      } else if (
        match.home_team_id !== filters.teamId &&
        match.away_team_id !== filters.teamId
      ) return false;
    }
    if (filters.clubId !== ALL_FIXTURES_FILTER) {
      const homeClub = match.external_home_team_id
        ? clubsByExternalTeam.get(match.external_home_team_id)?.clubId
        : null;
      const awayClub = match.external_away_team_id
        ? clubsByExternalTeam.get(match.external_away_team_id)?.clubId
        : null;
      if (homeClub !== filters.clubId && awayClub !== filters.clubId) return false;
    }
    return true;
  });
}

export function normalizeFixtureFilter(
  selectedId: string,
  options: FixtureFilterOption[],
): string {
  if (
    selectedId !== ALL_FIXTURES_FILTER &&
    !options.some((option) => option.id === selectedId)
  ) return ALL_FIXTURES_FILTER;
  return selectedId;
}

export function groupFixturesByRound(
  matches: CompetitionFixtureRow[],
): FixtureRoundGroup[] {
  const groups: FixtureRoundGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const match of matches) {
    const key = match.round_number != null ? `r${match.round_number}` : "unscheduled";
    const label = match.round_number != null
      ? `Round ${match.round_number}`
      : "Other matches";
    let index = indexByKey.get(key);
    if (index == null) {
      index = groups.length;
      indexByKey.set(key, index);
      groups.push({ key, label, items: [] });
    }
    groups[index].items.push(match);
  }
  return groups;
}

export function summarizeFixtureRounds(
  matches: CompetitionFixtureRow[],
): FixtureRoundSummary {
  const roundNumbers = Array.from(new Set(
    matches
      .map((match) => match.round_number)
      .filter((round): round is number => round != null),
  ));
  return {
    roundNumbers,
    totalRounds: roundNumbers.length,
    maximumRound: roundNumbers.length > 0 ? Math.max(...roundNumbers) : 0,
  };
}
