export type ScheduleMembershipScope = {
  teamIds: string[];
  clubIds: string[];
  clubAdminClubIds: string[];
  miniLeagueIds: string[];
};

export type ScheduleEventScope = {
  team_id?: string | null;
  club_id: string;
  mini_league_id?: string | null;
  is_cancelled?: boolean | null;
  updated_at?: string | null;
};

export function parseScheduleEntityFilter(teamFilter: string | null | undefined) {
  const selectedMiniLeagueId = teamFilter?.startsWith("ml:")
    ? teamFilter.slice(3) || null
    : null;
  return {
    selectedMiniLeagueId,
    selectedTeamId: teamFilter && !selectedMiniLeagueId ? teamFilter : null,
  };
}

export function retainRecentlyCancelledEvents<T extends ScheduleEventScope>(
  events: T[], now: Date, retentionHours = 48,
): T[] {
  const cutoff = now.getTime() - retentionHours * 60 * 60 * 1000;
  return events.filter((event) => {
    if (!event.is_cancelled) return true;
    if (!event.updated_at) return false;
    return new Date(event.updated_at).getTime() > cutoff;
  });
}

export function filterVisibleScheduleEvents<T extends ScheduleEventScope>(
  events: T[],
  scope: ScheduleMembershipScope,
  selectedTeamId: string | null,
  selectedMiniLeagueId: string | null,
): T[] {
  return events.filter((event) => {
    if (event.mini_league_id) {
      if (selectedMiniLeagueId) return event.mini_league_id === selectedMiniLeagueId;
      return scope.miniLeagueIds.includes(event.mini_league_id);
    }
    if (event.team_id) {
      if (selectedTeamId === event.team_id && scope.clubAdminClubIds.includes(event.club_id)) {
        return true;
      }
      return scope.teamIds.includes(event.team_id);
    }
    return scope.clubIds.includes(event.club_id);
  });
}
