export type CompetitionLadderTeam = {
  id: string;
  name: string;
};

export type CompetitionLadderRow = {
  competition_id: string;
  team_id: string | null;
  division_id: string | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goals_for: number | null;
  goals_against: number | null;
  goal_diff: number | null;
  points: number | null;
  teams?: CompetitionLadderTeam | null;
};

export type AcceptedCompetitionEntry = {
  team_id: string | null;
  division_id: string | null;
  status: string;
};

export type LadderFilterOption = {
  id: string;
  name: string;
};

export type LadderGroup = {
  divisionId: string;
  rows: CompetitionLadderRow[];
};
