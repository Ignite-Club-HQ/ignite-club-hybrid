export function mergeMemberships<T extends {
  roles: { role: string; club_id: string | null; team_id: string | null }[];
  teamIds: string[]; clubIds: string[]; clubAdminClubIds: string[];
  leagueAdminClubIds: string[]; miniLeagueIds: string[]; isAppAdmin: boolean;
}>(parts: T[]): T {
  const first = parts[0];
  if (!first) throw new Error('Membership discovery returned no results');
  const ids = (key: 'teamIds' | 'clubIds' | 'clubAdminClubIds' | 'leagueAdminClubIds' | 'miniLeagueIds') =>
    [...new Set(parts.flatMap(p => p[key]))];
  return { ...first,
    roles: [...new Map(parts.flatMap(p => p.roles).map(r => [`${r.role}:${r.club_id}:${r.team_id}`, r])).values()],
    teamIds: ids('teamIds'), clubIds: ids('clubIds'), clubAdminClubIds: ids('clubAdminClubIds'),
    leagueAdminClubIds: ids('leagueAdminClubIds'), miniLeagueIds: ids('miniLeagueIds'),
    isAppAdmin: parts.some(p => p.isAppAdmin),
  };
}