/**
 * Single source of truth for the teams an event targets.
 *
 * A single-team event takes precedence over targeted teams. A club-wide event
 * has no team filter, represented by null rather than an empty array.
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

  const targets = (event.target_team_ids ?? []).filter(Boolean);
  return targets.length > 0 ? targets : null;
}

export function isMiniLeagueEvent(event: EventAudienceLike | null | undefined): boolean {
  return Boolean(event?.mini_league_id);
}

/** Stable cache-key fragment for an event's targeted teams. */
export function eventTargetTeamKey(event: EventAudienceLike | null | undefined): string {
  const ids = getEventEligibleTeamIds(event);
  return ids ? [...ids].sort().join(',') : '';
}
