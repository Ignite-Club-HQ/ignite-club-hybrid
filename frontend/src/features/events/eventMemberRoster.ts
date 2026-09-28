export interface EventMemberProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface EventMemberRoleRow {
  user_id: string;
  role: string;
  team_id: string | null;
  profiles: EventMemberProfile | null;
}

export interface EventMemberRolePair {
  role: string;
  team_id: string | null;
}

export interface EventMemberRosterEntry extends EventMemberProfile {
  roles: string[];
  team_ids: string[];
  role_team_pairs: EventMemberRolePair[];
}

/**
 * Groups the rows returned by the page's already-scoped role query. The bot
 * exclusion stays here with the projection so every consumer gets the same
 * attendance-safe roster shape.
 */
export function buildEventMemberRoster(
  rows: readonly EventMemberRoleRow[],
  botUserId: string | null,
): EventMemberRosterEntry[] {
  const members = new Map<
    string,
    {
      profile: EventMemberProfile;
      roles: string[];
      teamIds: Set<string>;
      pairs: EventMemberRolePair[];
    }
  >();

  for (const row of rows) {
    if (!row.profiles || row.user_id === botUserId) continue;
    const existing = members.get(row.user_id);
    if (existing) {
      if (!existing.roles.includes(row.role)) existing.roles.push(row.role);
      if (row.team_id) existing.teamIds.add(row.team_id);
      existing.pairs.push({ role: row.role, team_id: row.team_id });
      continue;
    }
    members.set(row.user_id, {
      profile: row.profiles,
      roles: [row.role],
      teamIds: new Set(row.team_id ? [row.team_id] : []),
      pairs: [{ role: row.role, team_id: row.team_id }],
    });
  }

  return Array.from(members.values()).map(({ profile, roles, teamIds, pairs }) => ({
    ...profile,
    roles,
    team_ids: Array.from(teamIds),
    role_team_pairs: pairs,
  }));
}

export function filterEventMemberRoles(
  members: readonly EventMemberRosterEntry[],
  restrictedRoles: readonly string[],
): EventMemberRosterEntry[] {
  if (restrictedRoles.length === 0) return [...members];
  const allowedRoles = new Set(restrictedRoles);
  return members.filter((member) =>
    member.roles.some(
      (role) =>
        allowedRoles.has(role) ||
        role === "club_admin" ||
        role === "app_admin",
    ),
  );
}

export function scopeEventAttendanceMembers(
  members: readonly EventMemberRosterEntry[],
  options: {
    eventTeamId?: string | null;
    targetTeamIds?: readonly string[] | null;
  },
): EventMemberRosterEntry[] {
  if (options.eventTeamId || !options.targetTeamIds?.length) {
    return [...members];
  }

  const targetTeamIds = new Set(options.targetTeamIds);
  const clubLevelRoles = new Set([
    "club_admin",
    "app_admin",
    "committee_member",
  ]);

  return members
    .map((member) => {
      const scopedRoles = Array.from(
        new Set(
          member.role_team_pairs
            .filter(
              (pair) =>
                (pair.team_id && targetTeamIds.has(pair.team_id)) ||
                (!pair.team_id && clubLevelRoles.has(pair.role)),
            )
            .map((pair) => pair.role),
        ),
      );
      return scopedRoles.length
        ? { ...member, roles: scopedRoles }
        : null;
    })
    .filter((member): member is EventMemberRosterEntry => member !== null);
}
