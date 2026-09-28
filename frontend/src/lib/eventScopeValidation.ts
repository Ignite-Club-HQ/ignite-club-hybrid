/**
 * Frontend guard that mirrors the backend `validate_event_team_club_scope`
 * trigger. Shared between CreateEventPage and EditEventPage so both flows
 * fail closed with identical UX before ever submitting to Supabase.
 *
 * Result:
 *   { ok: true }                                            – safe to submit
 *   { ok: false, reason: "list_unavailable" }               – team list empty/stale
 *   { ok: false, reason: "team_not_in_club" }               – selected team belongs elsewhere
 */
export type EventScopeCheck =
  | { ok: true }
  | { ok: false; reason: "list_unavailable" | "team_not_in_club" };

export interface TeamScopeShape {
  id: string;
  club_id: string;
}

export function validateEventTeamClubScope(
  teamId: string | null | undefined,
  teams: TeamScopeShape[] | null | undefined,
  clubId: string | null | undefined,
): EventScopeCheck {
  // Club-wide events (no team_id) are always allowed.
  if (!teamId) return { ok: true };

  // Fail closed when the team list hasn't loaded or is empty — we must
  // never submit an ambiguous team_id+club_id combination.
  if (!teams || teams.length === 0) {
    return { ok: false, reason: "list_unavailable" };
  }

  const selected = teams.find((t) => t.id === teamId);
  if (!selected || selected.club_id !== clubId) {
    return { ok: false, reason: "team_not_in_club" };
  }

  return { ok: true };
}
