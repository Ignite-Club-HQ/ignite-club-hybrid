export interface HomeEventTiming {
  event_date: string;
  start_time?: string | null;
}

export function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getEventLocalDateKey(dateStr: string) {
  const hasTimeComponent =
    dateStr.includes("T") ||
    /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(dateStr);
  if (hasTimeComponent) {
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime())) {
      return getLocalDateKey(parsed);
    }
  }
  return dateStr.slice(0, 10);
}

export function getEventStartMs(event: HomeEventTiming) {
  const eventDateHasTime =
    !!event.event_date &&
    /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(event.event_date);

  if (event.start_time) {
    const isFullTimestamp =
      /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(event.start_time);
    if (isFullTimestamp) {
      if (eventDateHasTime) {
        const eventLocal = getEventLocalDateKey(event.event_date);
        const startLocal = getEventLocalDateKey(event.start_time);
        if (eventLocal !== startLocal) {
          const eventDate = new Date(event.event_date);
          return Number.isNaN(eventDate.getTime())
            ? Number.NaN
            : eventDate.getTime();
        }
      }
      return new Date(event.start_time).getTime();
    }
    return new Date(
      `${getEventLocalDateKey(event.event_date)}T${event.start_time}`,
    ).getTime();
  }

  const parsed = new Date(event.event_date);
  return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
}

export function isStillUpcomingForNextUp(
  event: HomeEventTiming,
  nowMs: number,
) {
  const todayKey = getLocalDateKey(new Date(nowMs));
  const eventKey = getEventLocalDateKey(event.event_date);
  if (eventKey < todayKey) return false;

  const startMs = getEventStartMs(event);
  return !(
    eventKey === todayKey &&
    !Number.isNaN(startMs) &&
    startMs + 30 * 60 * 1000 < nowMs
  );
}

export function selectVisibleHomeEvents<
  T extends HomeEventTiming & { club_id: string },
>(
  allEvents: T[] | undefined,
  activeClubFilter: string | null,
  nowMs: number,
  limit = 10,
) {
  if (!allEvents) return [];

  const freshEvents = allEvents.filter((event) =>
    isStillUpcomingForNextUp(event, nowMs),
  );
  const visibleEvents = activeClubFilter
    ? freshEvents.filter((event) => event.club_id === activeClubFilter)
    : freshEvents;
  return visibleEvents.slice(0, limit);
}

export interface HomeEventAudience {
  club_id: string;
  team_id?: string | null;
  target_team_ids?: string[] | null;
  mini_league_id?: string | null;
}

export interface HomeEventMemberships {
  teamIds: readonly string[];
  clubIds: readonly string[];
  /** null = don't filter mini-league events (backend has no player list). */
  miniLeagueIds: readonly string[] | null;
}

/**
 * Whether an event belongs in the signed-in user's Next Up. Club-level roles
 * (club admin, committee, competition/league admin) do NOT make someone part
 * of another team's game: team events need a role on that team, and
 * club-wide events aimed at specific teams need a role on one of them.
 */
export function isHomeEventForMember(
  event: HomeEventAudience,
  memberships: HomeEventMemberships,
): boolean {
  if (event.mini_league_id) {
    return memberships.miniLeagueIds === null
      ? true
      : memberships.miniLeagueIds.includes(event.mini_league_id);
  }
  if (event.team_id) return memberships.teamIds.includes(event.team_id);
  const targets = (event.target_team_ids ?? []).filter(Boolean);
  if (targets.length > 0) {
    return targets.some((teamId) => memberships.teamIds.includes(teamId));
  }
  return memberships.clubIds.includes(event.club_id);
}
