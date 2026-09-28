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
