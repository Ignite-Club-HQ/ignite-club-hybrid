/**
 * Authorization rules for fixture CSV/XLSX imports.
 *
 * Supabase RLS can permit each individual event insert when a user manages
 * every team involved, so multi-team import restriction must ALSO be enforced
 * explicitly in the frontend workflow (both as a blocking validation state and
 * again inside the submit handler).
 *
 * Rules:
 *   - Club admins may import for any number of teams.
 *   - Non-club-admins must have a team selected on the import page, and every
 *     fixture must resolve to exactly that team. A `team` column in the file
 *     can never be used to escape the selected team.
 */
export interface AuthorizableFixture {
  teamId?: string | null;
  teamName?: string | null;
}

export type FixtureImportAuthResult =
  | { ok: true }
  | { ok: false; message: string };

export const MULTI_TEAM_AUTH_MESSAGE =
  "Multi-team import requires club admin permissions";
export const NO_TEAM_SELECTED_MESSAGE =
  "Select a team before importing fixtures — only club admins can import without a selected team";
export const TEAM_MISMATCH_MESSAGE =
  "The file contains fixtures for a different team. Only club admins can import fixtures for other teams";

export function validateFixtureImportAuthorization(params: {
  isClubAdmin: boolean;
  teamId?: string | null;
  fixtures: AuthorizableFixture[];
}): FixtureImportAuthResult {
  const { isClubAdmin, teamId, fixtures } = params;

  if (fixtures.length === 0) return { ok: true };

  const distinctTeamIds = new Set(
    fixtures.map((f) => f.teamId || teamId || null).map((v) => v ?? "__none__"),
  );

  if (isClubAdmin) return { ok: true };

  // More than one distinct team in a single operation is club-admin only.
  if (distinctTeamIds.size > 1) {
    return { ok: false, message: MULTI_TEAM_AUTH_MESSAGE };
  }

  // Non-admins must be operating within a selected team scope.
  if (!teamId) {
    return { ok: false, message: NO_TEAM_SELECTED_MESSAGE };
  }

  // Every fixture must resolve to exactly the selected team.
  const escapes = fixtures.some((f) => (f.teamId || teamId) !== teamId);
  if (escapes) {
    return { ok: false, message: TEAM_MISMATCH_MESSAGE };
  }

  return { ok: true };
}
