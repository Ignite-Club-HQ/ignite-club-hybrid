export interface CompetitionFixtureEventLike {
  id: string;
  team_id?: string | null;
  competition_match_id?: string | null;
}

export async function fetchViewableCompetitionMatchIds(
  client: any,
): Promise<string[]> {
  const { data, error } = await client.rpc("get_my_viewable_competition_match_ids");
  if (error) throw error;
  return (data ?? []).map((row: { match_id: string } | string) => typeof row === "string" ? row : row.match_id);
}

export function makeCompetitionFixtureVisibility(
  teamIds: readonly string[],
  viewableCompetitionMatchIds: readonly string[],
  events: readonly CompetitionFixtureEventLike[],
) {
  const memberTeams = new Set(teamIds);
  const viewableMatches = new Set(viewableCompetitionMatchIds);
  const alreadyVisible = new Set(
    events
      .filter((event) => event.team_id && memberTeams.has(event.team_id) && event.competition_match_id)
      .map((event) => event.competition_match_id!),
  );

  return (event: CompetitionFixtureEventLike): boolean => {
    if (event.team_id && memberTeams.has(event.team_id)) return true;
    if (!event.team_id || !event.competition_match_id || !viewableMatches.has(event.competition_match_id)) return false;
    if (alreadyVisible.has(event.competition_match_id)) return false;
    alreadyVisible.add(event.competition_match_id);
    return true;
  };
}