export const competitionFixtureKeys = {
  matches: (competitionId: string) => ["competition-matches", competitionId] as const,
  linkedTeams: (competitionId: string, externalTeamCount: number) =>
    ["competition-linked-teams", competitionId, externalTeamCount] as const,
};
