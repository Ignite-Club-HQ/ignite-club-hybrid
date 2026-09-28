/**
 * Synthetic RLS model: local port of the `resolve_vault_record_scope` and
 * `authorize_vault_deletion` Postgres functions (see
 * reference/backend/supabase/migrations/20260727042355_51a7968c-ef11-4c89-96d4-d10c97fff65b.sql.md).
 *
 * These functions are self-contained (only `user_roles`, `mini_league_admins`,
 * `mini_leagues`, `teams`, `photos`, `vault_files` lookups — no dependency on
 * the undocumented `has_role`/`is_team_member` Postgres helpers used
 * elsewhere in the schema), so their authorization logic is reproduced here
 * exactly as pure TypeScript predicates over an in-memory synthetic
 * database, never executing SQL.
 */

export type VaultRecordKind = 'photo' | 'file';

export interface VaultRecordRow {
  id: string;
  club_id: string | null;
  team_id: string | null;
  mini_league_id: string | null;
  owner_id: string | null;
}

export interface UserRoleRow {
  user_id: string;
  role: string;
  club_id: string | null;
  team_id: string | null;
}

export interface TeamRow {
  id: string;
  club_id: string;
}

export interface MiniLeagueRow {
  id: string;
  club_id: string;
}

export interface MiniLeagueAdminRow {
  user_id: string;
  mini_league_id: string;
}

export interface VaultAuthorityDb {
  photos: VaultRecordRow[];
  vaultFiles: VaultRecordRow[];
  userRoles: UserRoleRow[];
  teams: TeamRow[];
  miniLeagues: MiniLeagueRow[];
  miniLeagueAdmins: MiniLeagueAdminRow[];
}

export interface ScopeResolution {
  found: boolean;
  reason: string;
  effectiveClubId: string | null;
  teamId: string | null;
  miniLeagueId: string | null;
  ownerId: string | null;
}

const notFound = (reason: string): ScopeResolution => ({
  found: reason === 'invalid_kind' || reason === 'not_found' ? false : true,
  reason,
  effectiveClubId: null,
  teamId: null,
  miniLeagueId: null,
  ownerId: null,
});

/** Local port of `public.resolve_vault_record_scope`. */
export function resolveVaultRecordScope(
  db: VaultAuthorityDb,
  kind: VaultRecordKind | string,
  recordId: string,
): ScopeResolution {
  let record: VaultRecordRow | undefined;
  if (kind === 'photo') {
    record = db.photos.find((p) => p.id === recordId);
  } else if (kind === 'file') {
    record = db.vaultFiles.find((f) => f.id === recordId);
  } else {
    return notFound('invalid_kind');
  }

  if (!record) return notFound('not_found');

  const directClub = record.club_id;
  let teamClub: string | null = null;
  if (record.team_id !== null) {
    const team = db.teams.find((t) => t.id === record!.team_id);
    teamClub = team ? team.club_id : null;
    if (!team) {
      return {
        found: true,
        reason: 'unresolvable_team_scope',
        effectiveClubId: null,
        teamId: record.team_id,
        miniLeagueId: record.mini_league_id,
        ownerId: record.owner_id,
      };
    }
  }

  let leagueClub: string | null = null;
  if (record.mini_league_id !== null) {
    const league = db.miniLeagues.find((m) => m.id === record!.mini_league_id);
    leagueClub = league ? league.club_id : null;
    if (!league) {
      return {
        found: true,
        reason: 'unresolvable_league_scope',
        effectiveClubId: null,
        teamId: record.team_id,
        miniLeagueId: record.mini_league_id,
        ownerId: record.owner_id,
      };
    }
  }

  const candidates = [...new Set([directClub, teamClub, leagueClub].filter((c): c is string => c !== null))];

  if (candidates.length === 0) {
    return {
      found: true,
      reason: 'no_scope',
      effectiveClubId: null,
      teamId: record.team_id,
      miniLeagueId: record.mini_league_id,
      ownerId: record.owner_id,
    };
  }
  if (candidates.length > 1) {
    return {
      found: true,
      reason: 'scope_conflict',
      effectiveClubId: null,
      teamId: record.team_id,
      miniLeagueId: record.mini_league_id,
      ownerId: record.owner_id,
    };
  }

  return {
    found: true,
    reason: 'ok',
    effectiveClubId: candidates[0],
    teamId: record.team_id,
    miniLeagueId: record.mini_league_id,
    ownerId: record.owner_id,
  };
}

export interface AuthorizationResult {
  authorized: boolean;
  reason: string;
}

/** Local port of `public.authorize_vault_deletion`. */
export function authorizeVaultDeletion(
  db: VaultAuthorityDb,
  callerId: string | null,
  kind: VaultRecordKind | string,
  recordId: string,
): AuthorizationResult {
  if (callerId === null) return { authorized: false, reason: 'unauthorized' };

  const scope = resolveVaultRecordScope(db, kind, recordId);

  // App admins may delete anything that exists.
  const isAppAdmin = db.userRoles.some((ur) => ur.user_id === callerId && ur.role === 'app_admin');
  if (isAppAdmin) {
    if (!scope.found) return { authorized: false, reason: scope.reason };
    return { authorized: true, reason: 'app_admin' };
  }

  if (!scope.found || scope.reason !== 'ok' || scope.effectiveClubId === null) {
    return { authorized: false, reason: scope.found ? scope.reason : 'not_found' };
  }

  // Club admin / committee member of the effective club.
  let authorized = db.userRoles.some(
    (ur) =>
      ur.user_id === callerId &&
      (ur.role === 'club_admin' || ur.role === 'committee_member') &&
      ur.club_id === scope.effectiveClubId,
  );

  // Team admin of the exact team.
  if (!authorized && scope.teamId !== null) {
    authorized = db.userRoles.some(
      (ur) => ur.user_id === callerId && ur.role === 'team_admin' && ur.team_id === scope.teamId,
    );
  }

  // Mini-league admin of the exact mini-league (and its club).
  if (!authorized && scope.miniLeagueId !== null) {
    authorized = db.miniLeagueAdmins.some(
      (mla) =>
        mla.user_id === callerId &&
        mla.mini_league_id === scope.miniLeagueId &&
        db.miniLeagues.some((ml) => ml.id === scope.miniLeagueId && ml.club_id === scope.effectiveClubId),
    );
  }

  // Original uploader of the exact record.
  if (!authorized && scope.ownerId !== null && scope.ownerId === callerId) {
    authorized = true;
  }

  if (!authorized) return { authorized: false, reason: 'forbidden' };

  return { authorized: true, reason: 'ok' };
}
