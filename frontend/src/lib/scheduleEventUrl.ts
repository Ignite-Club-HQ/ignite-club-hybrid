export function scheduleEventUrl(origin: string, event: { id: string; competition_id?: string | null; is_competition_fixture?: boolean }) {
  return event.is_competition_fixture && event.competition_id
    ? `${origin}/competitions/${encodeURIComponent(event.competition_id)}`
    : `${origin}/events/${encodeURIComponent(event.id)}`;
}