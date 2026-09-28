export interface HomeUserRsvp {
  event_id: string;
  status: string;
}

/**
 * Read the signed-in adult's RSVP status for events currently visible on Home.
 * Child RSVP rows are deliberately excluded because Home's compact action
 * represents the signed-in user; child responses are managed in the RSVP flow.
 */
export async function fetchHomeUserRsvps(
  client: any,
  userId: string,
  eventIds: readonly string[],
): Promise<HomeUserRsvp[]> {
  if (eventIds.length === 0) return [];

  const { data, error } = await client
    .from("rsvps")
    .select("event_id, status")
    .eq("user_id", userId)
    .is("child_id", null)
    .in("event_id", [...eventIds]);

  if (error) throw error;
  return data ?? [];
}
