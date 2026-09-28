/**
 * Local equivalent of the "keeps Vault destructive authority aligned to club
 * and exact-team administration" case from the exported
 * `tests/local-supabase/role-surface-access-matrix.test.ts` bundle suite.
 *
 * The original bundle test exercises the real `authorize_vault_deletion`
 * Postgres RPC against a live local Supabase/Postgres instance. That
 * function (and its `resolve_vault_record_scope` dependency) is
 * self-contained — it never calls the undocumented `has_role`/
 * `is_team_member` helpers used elsewhere in the schema — so its exact
 * authorization logic is faithfully reproduced as a synthetic, in-memory RLS
 * model in `frontend/src/lab/rls/vaultDeletionAuthority.ts` and exercised
 * here with the same fixture roles and expected authority matrix.
 *
 * The remaining cases in that bundle file (club/team message and event/photo
 * INSERT authorization across all 7 roles) depend on the `has_role` and
 * `is_team_member` Postgres helper functions, whose canonical definitions do
 * not appear anywhere in the exported/sanitized migration corpus (confirmed
 * by exhaustive search) — see docs/VALIDATION.md for the documented
 * evidence gap.
 */
import { describe, expect, it } from 'vitest';
import {
  authorizeVaultDeletion,
  type VaultAuthorityDb,
} from '../src/lab/rls/vaultDeletionAuthority';

type MatrixRole =
  | 'club_admin'
  | 'committee_member'
  | 'team_admin'
  | 'coach'
  | 'player'
  | 'parent'
  | 'league_admin';

describe('vault deletion authority matches the exact club/team administration matrix', () => {
  it('keeps Vault destructive authority aligned to club and exact-team administration', () => {
    const clubId = 'club-a';
    const teamId = 'team-a';
    const memberAId = 'member-a'; // uploads the club file
    const adminAId = 'admin-a'; // uploads the team file

    const roleUserIds: Record<Exclude<MatrixRole, 'club_admin' | 'player'>, string> = {
      committee_member: 'committee-member-a',
      team_admin: 'team-admin-a',
      coach: 'coach-a',
      parent: 'parent-a',
      league_admin: 'league-admin-a',
    };

    const db: VaultAuthorityDb = {
      photos: [],
      vaultFiles: [
        { id: 'club-file', club_id: clubId, team_id: null, mini_league_id: null, owner_id: memberAId },
        { id: 'team-file', club_id: null, team_id: teamId, mini_league_id: null, owner_id: adminAId },
      ],
      userRoles: [
        { user_id: adminAId, role: 'club_admin', club_id: clubId, team_id: null },
        { user_id: memberAId, role: 'player', club_id: clubId, team_id: teamId },
        { user_id: roleUserIds.committee_member, role: 'committee_member', club_id: clubId, team_id: null },
        { user_id: roleUserIds.team_admin, role: 'team_admin', club_id: clubId, team_id: teamId },
        { user_id: roleUserIds.coach, role: 'coach', club_id: clubId, team_id: teamId },
        { user_id: roleUserIds.parent, role: 'parent', club_id: clubId, team_id: teamId },
        { user_id: roleUserIds.league_admin, role: 'league_admin', club_id: clubId, team_id: null },
      ],
      teams: [{ id: teamId, club_id: clubId }],
      miniLeagues: [],
      miniLeagueAdmins: [],
    };

    const actors: Array<{ role: MatrixRole; userId: string }> = [
      { role: 'club_admin', userId: adminAId },
      { role: 'player', userId: memberAId },
      { role: 'committee_member', userId: roleUserIds.committee_member },
      { role: 'team_admin', userId: roleUserIds.team_admin },
      { role: 'coach', userId: roleUserIds.coach },
      { role: 'parent', userId: roleUserIds.parent },
      { role: 'league_admin', userId: roleUserIds.league_admin },
    ];

    const expected: Record<MatrixRole, { club: boolean; team: boolean }> = {
      club_admin: { club: true, team: true },
      committee_member: { club: true, team: true },
      team_admin: { club: false, team: true },
      coach: { club: false, team: false },
      player: { club: true, team: false }, // original uploader owns the club file
      parent: { club: false, team: false },
      league_admin: { club: false, team: false },
    };

    for (const current of actors) {
      const clubAuth = authorizeVaultDeletion(db, current.userId, 'file', 'club-file');
      const teamAuth = authorizeVaultDeletion(db, current.userId, 'file', 'team-file');
      expect(clubAuth.authorized, `${current.role} club Vault authority`).toBe(expected[current.role].club);
      expect(teamAuth.authorized, `${current.role} team Vault authority`).toBe(expected[current.role].team);
    }
  });
});
