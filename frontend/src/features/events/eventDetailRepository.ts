/** Core Event Detail read boundary. */
export const EVENT_DETAIL_SELECT =
  "*, teams (name, default_match_arrival_minutes, default_rsvp_audience), clubs!club_id (name, is_pro, sport)";

/**
 * Returns the event row, or `null` when it does not exist/is not visible.
 * Transport, authorization and database failures are propagated unchanged so
 * the page can distinguish them from a legitimate not-found result.
 */
export async function fetchEventDetail(client: any, eventId: string) {
  const { data, error } = await client
    .from("events")
    .select(EVENT_DETAIL_SELECT)
    .eq("id", eventId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}
