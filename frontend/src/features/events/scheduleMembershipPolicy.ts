export type ScheduleRoleRow = {
  role: string;
  club_id?: string | null;
  team_id?: string | null;
};

/** Derive direct schedule scope from user_roles without performing any reads. */
export function deriveRoleScheduleScope(rows: ScheduleRoleRow[] | null | undefined) {
  const teamIds = (rows ?? []).filter((row) => row.team_id).map((row) => row.team_id as string);
  const clubIds = new Set<string>();
  const clubAdminClubIds = new Set<string>();
  const leagueAdminClubIds = new Set<string>();
  let isAppAdmin = false;

  for (const row of rows ?? []) {
    if (row.role === "app_admin") isAppAdmin = true;
    if (!row.club_id) continue;
    clubIds.add(row.club_id);
    if (row.role === "club_admin" || row.role === "app_admin") {
      clubAdminClubIds.add(row.club_id);
    }
    // Club admins intentionally do not inherit every mini-league in the club.
    if (row.role === "league_admin" || row.role === "app_admin") {
      leagueAdminClubIds.add(row.club_id);
    }
  }

  return {
    teamIds,
    clubIds,
    clubAdminClubIds,
    leagueAdminClubIds,
    isAppAdmin,
  };
}

export function uniqueIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
