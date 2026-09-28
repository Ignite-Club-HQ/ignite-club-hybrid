export type FixtureTeam = {
  id: string;
  name: string;
};

export type CompetitionFixtureRow = {
  id: string;
  competition_id: string;
  division_id: string | null;
  round_number: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home: FixtureTeam | null;
  away: FixtureTeam | null;
  external_home_team_id?: string | null;
  external_away_team_id?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
};

export type LinkedCompetitionTeam = {
  id: string;
  name: string;
  playhq_team_id: string | null;
  club_id?: string | null;
  clubs: {
    id: string;
    name: string;
  } | null;
};

export type CompetitionDivisionSummary = {
  id: string;
  name: string;
  hide_ladder?: boolean;
};
