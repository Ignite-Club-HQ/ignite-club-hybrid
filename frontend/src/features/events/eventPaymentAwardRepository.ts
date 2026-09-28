/** Paid-member markers for one event. Access remains controlled by RLS. */
export async function fetchEventPayments(client: any, eventId: string) {
  const { data, error } = await client
    .from("event_payments")
    .select("user_id")
    .eq("event_id", eventId);
  if (error) throw error;
  return data ?? [];
}

async function fetchSingleMatchMarker(client: any, table: string, eventId: string) {
  const { data, error } = await client
    .from(table)
    .select("user_id, child_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export function fetchMatchCaptain(client: any, eventId: string) {
  return fetchSingleMatchMarker(client, "match_captains", eventId);
}

export function fetchPlayerOfMatch(client: any, eventId: string) {
  return fetchSingleMatchMarker(client, "player_of_match", eventId);
}

export async function fetchMatchGoalkeepers(client: any, eventId: string) {
  const { data, error } = await client
    .from("match_goalkeepers")
    .select("user_id, child_id")
    .eq("event_id", eventId);
  if (error) throw error;
  return data ?? [];
}
