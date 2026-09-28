/**
 * Single source of truth for "which teams is this event actually for".
 *
 * Events express their audience three ways:
 *   (a) team_id set                        → that one team
 *   (b) team_id NULL + target_team_ids[]   → club-wide event targeted at teams
 *   (c) team_id NULL + no targets          → genuinely club-wide (no team filter)
 *
 * Returning `null` means "no team filter" — callers must treat that as
 * club-wide, NOT as "everything allowed everywhere". Mini-league events keep
 * their own player-based path and are reported via `isMiniLeagueEvent`.
 */
export type EventAudienceLike = {
  team_id?: string | null;
  target_team_ids?: string[] | null;
  mini_league_id?: string | null;
};

export function getEventEligibleTeamIds(
  event: EventAudienceLike | null | undefined,
): string[] | null {
  if (!event) return null;
  if (event.team_id) return [event.team_id];
  const targets = (event.target_team_ids ?? []).filter(Boolean) as string[];
  if (targets.length > 0) return targets;
  return null;
}

export function isMiniLeagueEvent(event: EventAudienceLike | null | undefined): boolean {
  return !!event?.mini_league_id;
}

/** Stable cache-key fragment for an event's targeted teams. */
export function eventTargetTeamKey(event: EventAudienceLike | null | undefined): string {
  const ids = getEventEligibleTeamIds(event);
  return ids ? [...ids].sort().join(",") : "";
}
