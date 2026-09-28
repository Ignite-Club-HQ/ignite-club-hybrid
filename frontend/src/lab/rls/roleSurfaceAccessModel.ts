/**
 * Synthetic, in-memory reconstruction of the role-scoped RLS authorization
 * checks exercised by the exported `role-surface-access-matrix.test.ts`
 * suite for `team_messages`, `events`, and `photos`.
 *
 * Ported (not executed) from the final chronologically-active Postgres
 * policy/function text found in `reference/backend/supabase/migrations/**`:
 *  - `is_team_member(_user_id, _team_id)` final definition:
 *    `20260721114111_aa56e96d-22f4-415a-bedd-486e04eb5849.sql.md`.
 *  - `team_messages` "Team members can send team messages" INSERT policy:
 *    `20260330230254_a2d401b8-da5c-47bd-b01b-d50851cdd052.sql.md`.
 *  - `events` "Admins/coaches can create events" INSERT policy:
 *    `20260723042735_5edd8fe5-0b98-4609-993b-6504857496f2.sql.md`.
 *  - `can_publish_club_wide_photo(_user_id, _club_id)` and the "Scoped
 *    role-checked photo uploads" INSERT policy:
 *    `20260809090816_4268fd0f-0146-478c-afbe-ecee7f2ade26.sql.md`.
 *
 * `has_role(_user_id, _role, _club_id, _team_id)` itself has no `CREATE
 * FUNCTION` definition anywhere in the exported migration corpus (it is a
 * baseline/bootstrap helper that predates the exported history). Its
 * semantics below were reverse-engineered from every call site that
 * exercises this test's fixture data and cross-validated against all 21
 * `it.each` cases ported alongside this module (7 team-chat + 7 club-wide
 * event + 7 exact-team event, each independently exact-matching the
 * bundle's expected pass/fail outcome with zero contradictions):
 *  - The `_club_id` filter is a wildcard when `null` (any club matches),
 *    and otherwise must equal the row's `club_id` exactly.
 *  - The `_team_id` filter always requires an exact match against the
 *    row's `team_id`, including `null` matching only a `null` row value
 *    (it is never a wildcard).
 *
 * This inferred model does NOT extend to the `club_messages` INSERT
 * policy: that policy's text (also fully extracted) has no branch at all
 * admitting a bare `league_admin` role, yet the bundle test expects every
 * one of 7 roles - including `league_admin` - to succeed unconditionally.
 * That specific contradiction, and the fact that `club_messages` never
 * received an explicit SELECT policy anywhere in the exported corpus
 * either, are documented as a genuine, irreducible evidence gap and are
 * intentionally NOT modeled here.
 */

export type MatrixRole =
  | 'club_admin'
  | 'committee_member'
  | 'team_admin'
  | 'coach'
  | 'player'
  | 'parent'
  | 'league_admin'
  | 'app_admin';

export interface UserRoleRow {
  userId: string;
  role: MatrixRole;
  clubId: string | null;
  teamId: string | null;
}

export interface TeamRow {
  id: string;
  clubId: string;
}

export interface ChildTeamAssignmentRow {
  teamId: string;
  parentUserId?: string;
  guardianUserId?: string;
}

/** Reverse-engineered `has_role` per the module doc comment above. */
export function hasRole(
  roles: UserRoleRow[],
  userId: string,
  role: MatrixRole,
  clubIdFilter: string | null,
  teamIdFilter: string | null,
): boolean {
  return roles.some(
    (r) =>
      r.userId === userId &&
      r.role === role &&
      (clubIdFilter === null || r.clubId === clubIdFilter) &&
      r.teamId === teamIdFilter,
  );
}

/** Faithful port of the final `is_team_member(_user_id, _team_id)` SQL. */
export function isTeamMember(
  roles: UserRoleRow[],
  childAssignments: ChildTeamAssignmentRow[],
  userId: string,
  teamId: string,
): boolean {
  const direct = roles.some((r) => r.userId === userId && r.teamId === teamId);
  const asParent = childAssignments.some((a) => a.teamId === teamId && a.parentUserId === userId);
  const asGuardian = childAssignments.some((a) => a.teamId === teamId && a.guardianUserId === userId);
  return direct || asParent || asGuardian;
}

/** `team_messages` "Team members can send team messages" WITH CHECK. */
export function canInsertTeamMessage(
  roles: UserRoleRow[],
  teams: TeamRow[],
  childAssignments: ChildTeamAssignmentRow[],
  authorId: string,
  teamId: string,
): boolean {
  const team = teams.find((t) => t.id === teamId);
  return (
    isTeamMember(roles, childAssignments, authorId, teamId) ||
    (team !== undefined && hasRole(roles, authorId, 'club_admin', team.clubId, null)) ||
    hasRole(roles, authorId, 'app_admin', null, null)
  );
}

export interface EventInsertCandidate {
  clubId: string;
  teamId: string | null;
  miniLeagueId: string | null;
  type: 'game' | 'training' | 'social' | 'mini_league';
}

/** `events` "Admins/coaches can create events" WITH CHECK. */
export function canInsertEvent(
  roles: UserRoleRow[],
  userId: string,
  event: EventInsertCandidate,
): boolean {
  const clubAdmin = hasRole(roles, userId, 'club_admin', event.clubId, null);
  const teamAdmin = hasRole(roles, userId, 'team_admin', null, event.teamId);
  const coach = hasRole(roles, userId, 'coach', null, event.teamId);
  const miniLeagueAdmin =
    event.miniLeagueId !== null && hasRole(roles, userId, 'league_admin', event.clubId, null);
  const miniLeagueCoach =
    event.miniLeagueId !== null && hasRole(roles, userId, 'coach', event.clubId, null);
  const committeeSocialOrGame =
    hasRole(roles, userId, 'committee_member', event.clubId, null) &&
    event.teamId === null &&
    (event.type === 'social' || event.type === 'game');
  return clubAdmin || teamAdmin || coach || miniLeagueAdmin || miniLeagueCoach || committeeSocialOrGame;
}

/** `can_publish_club_wide_photo(_user_id, _club_id)`, club-wide branch only. */
export function canPublishClubWidePhoto(
  roles: UserRoleRow[],
  teams: TeamRow[],
  userId: string,
  clubId: string,
): boolean {
  const isAppAdmin = roles.some((r) => r.userId === userId && r.role === 'app_admin');
  const elevatedRoles: MatrixRole[] = ['club_admin', 'committee_member', 'team_admin', 'coach'];
  const scopedElevated = roles.some((r) => {
    if (r.userId !== userId || !elevatedRoles.includes(r.role)) return false;
    if (r.clubId === clubId) return true;
    const team = r.teamId !== null ? teams.find((t) => t.id === r.teamId) : undefined;
    return team !== undefined && team.clubId === clubId;
  });
  return isAppAdmin || scopedElevated;
}
