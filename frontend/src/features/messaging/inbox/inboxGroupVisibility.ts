export interface InboxGroupVisibilityRow {
  club_id?: string | null;
  team_id?: string | null;
  mini_league_id?: string | null;
  allowed_roles?: readonly string[] | null;
}

export interface InboxRoleScope {
  role: string;
  club_id?: string | null;
  team_id?: string | null;
}

export interface InboxGroupVisibilityInput<
  TGroup extends InboxGroupVisibilityRow,
  TRole extends InboxRoleScope,
> {
  groups: readonly TGroup[];
  roles: readonly TRole[] | null | undefined;
  leagueIds: ReadonlySet<string> | null | undefined;
  isAppAdmin: boolean;
  isCommitteeMember: boolean;
  isOnline: boolean;
}

const LEAGUE_ADMIN_ROLES = new Set([
  "club_admin",
  "league_admin",
  "coach",
  "team_admin",
]);

/**
 * Applies the page's role-aware visibility policy to already-authorized group
 * rows. Supabase RLS remains authoritative; this function only decides which
 * of those rows the inbox presents for the current role context.
 */
export function filterInboxGroupsByVisibility<
  TGroup extends InboxGroupVisibilityRow,
  TRole extends InboxRoleScope,
>({
  groups,
  roles,
  leagueIds,
  isAppAdmin,
  isCommitteeMember,
  isOnline,
}: InboxGroupVisibilityInput<TGroup, TRole>): readonly TGroup[] {
  if (isAppAdmin || isCommitteeMember) return groups;

  // Offline cache is user-scoped and was RLS/role filtered when persisted.
  // Do not blank it merely because role queries cannot run without a network.
  if (!isOnline && !roles?.length) return groups;

  return groups.filter((group) => {
    // Personal groups are membership-authorized through group_members + RLS.
    if (!group.club_id && !group.team_id && !group.mini_league_id) return true;
    if (!roles?.length) return false;

    const allowedRoles = group.allowed_roles ?? [];
    if (allowedRoles.length === 0) return true;

    if (group.mini_league_id) {
      const isLeagueAdmin = roles.some(
        (role) => LEAGUE_ADMIN_ROLES.has(role.role) && role.club_id === group.club_id,
      );
      if (isLeagueAdmin) return true;
      if (!leagueIds?.has(group.mini_league_id)) return false;
    }

    return roles.some((role) => {
      if (!allowedRoles.includes(role.role)) return false;
      if (group.club_id && !group.team_id && !group.mini_league_id) {
        return role.club_id === group.club_id;
      }
      if (group.team_id) return role.team_id === group.team_id;
      return true;
    });
  });
}
