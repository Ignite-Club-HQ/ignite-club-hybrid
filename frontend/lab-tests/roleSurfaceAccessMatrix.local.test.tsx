/**
 * Local, synthetic-database equivalent of 28 of the 37 exported
 * `role-surface-access-matrix.test.ts` cases, covering the
 * `team_messages`, `events`, and `photos` role-access matrices via
 * `src/lab/rls/roleSurfaceAccessModel.ts` (a faithful port of the final
 * active Postgres RLS policy/function text for those three tables - see
 * that module's doc comment for exact migration citations and the
 * reverse-engineered `has_role` semantics, cross-validated to zero
 * contradictions across every case below).
 *
 * The remaining 9 cases from that bundle file are NOT represented here:
 *  - The 7 `club_messages` "read and send" cases, and the `club_messages`
 *    portion of "denies every role outside its club", depend on a
 *    `club_messages` SELECT policy and a `has_role`-gated INSERT branch
 *    for `league_admin` that literally do not exist anywhere in the
 *    exported migration corpus (both are pre-export baseline/bootstrap
 *    definitions). Worse, the fully-extracted INSERT policy text has NO
 *    branch admitting a bare `league_admin` role at all, yet the bundle
 *    test expects `league_admin` to succeed unconditionally alongside the
 *    other 6 roles - a genuine, irreducible contradiction with the
 *    available evidence, not merely a missing definition.
 *  - The Vault-authority case (1/37) was already ported separately in
 *    `lab-tests/vaultDeletionAuthority.local.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import {
  canInsertEvent,
  canInsertTeamMessage,
  canPublishClubWidePhoto,
  type MatrixRole,
  type TeamRow,
  type UserRoleRow,
} from '../src/lab/rls/roleSurfaceAccessModel';

const clubA = 'club-a';
const clubB = 'club-b';
const teamA = 'team-a';

const teams: TeamRow[] = [{ id: teamA, clubId: clubA }];

function buildRoles(): UserRoleRow[] {
  const teamScoped: MatrixRole[] = ['team_admin', 'coach', 'parent'];
  const roles: UserRoleRow[] = [
    { userId: 'club_admin', role: 'club_admin', clubId: clubA, teamId: null },
    { userId: 'player', role: 'player', clubId: clubA, teamId: teamA },
  ];
  for (const role of ['committee_member', 'team_admin', 'coach', 'parent', 'league_admin'] as MatrixRole[]) {
    roles.push({ userId: role, role, clubId: clubA, teamId: teamScoped.includes(role) ? teamA : null });
  }
  return roles;
}

const allRoles = buildRoles();

describe('local RLS: role-scoped messaging, event, and media surfaces', () => {
  it.each([
    ['club_admin', true],
    ['committee_member', false],
    ['team_admin', true],
    ['coach', true],
    ['player', true],
    ['parent', true],
    ['league_admin', false],
  ] as Array<[MatrixRole, boolean]>)(
    'enforces exact team-chat membership for %s',
    (role, allowed) => {
      expect(canInsertTeamMessage(allRoles, teams, [], role, teamA)).toBe(allowed);
    },
  );

  it.each([
    ['club_admin', true],
    ['committee_member', true],
    ['team_admin', false],
    ['coach', false],
    ['player', false],
    ['parent', false],
    ['league_admin', false],
  ] as Array<[MatrixRole, boolean]>)(
    'enforces club-wide game creation for %s',
    (role, allowed) => {
      const allowedResult = canInsertEvent(allRoles, role, {
        clubId: clubA,
        teamId: null,
        miniLeagueId: null,
        type: 'game',
      });
      expect(allowedResult).toBe(allowed);
    },
  );

  it.each([
    ['club_admin', true],
    ['committee_member', false],
    ['team_admin', true],
    ['coach', true],
    ['player', false],
    ['parent', false],
    ['league_admin', false],
  ] as Array<[MatrixRole, boolean]>)(
    'enforces exact-team event creation for %s',
    (role, allowed) => {
      const allowedResult = canInsertEvent(allRoles, role, {
        clubId: clubA,
        teamId: teamA,
        miniLeagueId: null,
        type: 'training',
      });
      expect(allowedResult).toBe(allowed);
    },
  );

  it.each([
    ['club_admin', true],
    ['committee_member', true],
    ['team_admin', true],
    ['coach', true],
    ['player', false],
    ['parent', false],
    ['league_admin', false],
  ] as Array<[MatrixRole, boolean]>)(
    'enforces club-wide Media Gallery publishing for %s',
    (role, allowed) => {
      expect(canPublishClubWidePhoto(allRoles, teams, role, clubA)).toBe(allowed);
    },
  );

  it('denies team-chat and event-creation surfaces to a role outside the club', () => {
    // Mirrors the team_messages/events/photos portions of the bundle's
    // "denies every role outside its club across all four surfaces" case;
    // the club_messages portion is not representable (see file doc comment).
    const outsider: MatrixRole = 'club_admin';
    const outsiderRoles: UserRoleRow[] = [{ userId: 'outsider', role: outsider, clubId: clubB, teamId: null }];
    expect(canInsertTeamMessage(outsiderRoles, teams, [], 'outsider', teamA)).toBe(false);
    expect(
      canInsertEvent(outsiderRoles, 'outsider', { clubId: clubA, teamId: teamA, miniLeagueId: null, type: 'training' }),
    ).toBe(false);
    expect(canPublishClubWidePhoto(outsiderRoles, teams, 'outsider', clubA)).toBe(false);
  });

});
