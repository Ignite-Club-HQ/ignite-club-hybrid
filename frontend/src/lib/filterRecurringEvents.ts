/**
 * Limits recurring event series to only show the next N occurrences in EACH
 * direction (past + future) relative to "now".
 *
 * Why split past/future:
 *  - List views fetch a window like "last 30 days + everything upcoming".
 *  - Counting past + future together caused the cap to be exhausted by past
 *    occurrences, hiding all upcoming trainings (e.g. weekly series with 4
 *    past Thursdays would consume the cap before any future date appeared).
 *
 * Non-recurring events pass through unchanged.
 * Events are assumed to be sorted by event_date ascending.
 */
export function filterRecurringEvents<
  T extends {
    id: string;
    parent_event_id: string | null;
    is_recurring: boolean;
    event_date: string;
  }
>(events: T[], maxPerSeries: number = 4): T[] {
  const now = Date.now();
  // Track counts per series, per direction (past vs upcoming).
  const pastCounts = new Map<string, number>();
  const upcomingCounts = new Map<string, number>();

  // For past occurrences we want the MOST RECENT N (not the oldest N), so
  // walk past entries in reverse and admit them, then re-sort at the end.
  // Implementation: do a first pass that decides keep/drop per index, then
  // return events in original order.
  const keep = new Array<boolean>(events.length).fill(false);

  // Forward pass for upcoming (oldest-upcoming first → keeps next N).
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event.parent_event_id && !event.is_recurring) {
      keep[i] = true;
      continue;
    }
    const ts = new Date(event.event_date).getTime();
    if (Number.isNaN(ts) || ts < now) continue;
    const seriesKey = event.parent_event_id || event.id;
    const count = upcomingCounts.get(seriesKey) || 0;
    if (count >= maxPerSeries) continue;
    upcomingCounts.set(seriesKey, count + 1);
    keep[i] = true;
  }

  // Reverse pass for past (newest-past first → keeps most recent N).
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (keep[i]) continue;
    if (!event.parent_event_id && !event.is_recurring) continue;
    const ts = new Date(event.event_date).getTime();
    if (Number.isNaN(ts) || ts >= now) continue;
    const seriesKey = event.parent_event_id || event.id;
    const count = pastCounts.get(seriesKey) || 0;
    if (count >= maxPerSeries) continue;
    pastCounts.set(seriesKey, count + 1);
    keep[i] = true;
  }

  return events.filter((_, i) => keep[i]);
}
