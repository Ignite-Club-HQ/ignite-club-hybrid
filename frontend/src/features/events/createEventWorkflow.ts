export type CreateEventTransactionInput = {
  event: Record<string, unknown>;
  eventDate: string;
  childDates: string[] | null;
  duties: Array<{ name: string; assigned_to: string | null }>;
};

/**
 * Persist an event, recurring children and duties through the existing atomic
 * RPC. Cache refresh, navigation and user messaging remain controller-owned.
 */
export async function createEventTransaction(
  client: any,
  input: CreateEventTransactionInput,
): Promise<string> {
  const { data: eventId, error } = await client.rpc("create_event_with_duties", {
    p_event: { ...input.event, event_date: input.eventDate },
    p_child_dates: input.childDates,
    p_duties: input.duties,
  });
  if (error) throw error;
  if (!eventId) throw new Error("Event could not be created.");
  return eventId;
}
