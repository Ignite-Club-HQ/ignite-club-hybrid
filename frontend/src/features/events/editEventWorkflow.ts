export type EventUpdateTransactionInput = {
  eventId: string;
  updates: Record<string, unknown>;
  selectedEventDate: string;
  selectedStartTime: string | null;
  selectedEndTime: string | null;
  updateSeries: boolean;
};

export type EventDutyInput = {
  id?: string;
  name: string;
  assignedTo: string | null;
};

export type RecurringConversionInput = {
  eventId: string;
  updates: Record<string, unknown>;
  selectedDate: Date;
  selectedStartTime: string | null;
  selectedEndTime: string | null;
  occurrenceDates: Date[];
  recurrenceEndDate: string;
};

/**
 * Persist either the selected occurrence or its entire existing series while
 * preserving the established database contracts.
 */
export async function updateEventTransaction(
  client: any,
  input: EventUpdateTransactionInput,
): Promise<void> {
  if (input.updateSeries) {
    const { error } = await client.rpc("update_event_series", {
      p_event_id: input.eventId,
      p_updates: input.updates,
      p_selected_event_date: input.selectedEventDate,
      p_selected_start_time: input.selectedStartTime,
      p_selected_end_time: input.selectedEndTime,
    });
    if (error) throw error;
    return;
  }

  const { error } = await client
    .from("events")
    .update({
      ...input.updates,
      event_date: input.selectedEventDate,
      start_time: input.selectedStartTime,
      end_time: input.selectedEndTime,
    })
    .eq("id", input.eventId);
  if (error) throw error;
}

/** Apply all duty additions, edits and removals using the existing atomic RPC. */
export async function syncEventDuties(
  client: any,
  eventId: string,
  deleteIds: string[],
  duties: EventDutyInput[],
): Promise<Array<{ idx: number; id: string }>> {
  const { data, error } = await client.rpc("sync_event_duties", {
    p_event_id: eventId,
    p_delete_ids: deleteIds,
    p_duties: duties.map((duty, idx) => ({
      idx,
      id: duty.id ?? null,
      name: duty.name,
      assigned_to: duty.assignedTo,
    })),
  });
  if (error) throw error;
  return (data as Array<{ idx: number; id: string }> | null) ?? [];
}

/**
 * Convert an existing single event into a recurring parent and its children.
 *
 * Parent conversion and child insertion are delegated to one database
 * transaction. Child scope and creator identity are derived server-side.
 */
export async function convertEventToRecurringSeries(
  client: any,
  input: RecurringConversionInput,
): Promise<number> {
  const durationMs = input.selectedEndTime
    ? new Date(input.selectedEndTime).getTime() - input.selectedDate.getTime()
    : null;
  const childEvents = input.occurrenceDates.slice(1).map((date) => {
    const childDateTime = new Date(date);
    childDateTime.setHours(input.selectedDate.getHours(), input.selectedDate.getMinutes());
    return {
      event_date: childDateTime.toISOString(),
      start_time: childDateTime.toISOString(),
      end_time: durationMs === null
        ? null
        : new Date(childDateTime.getTime() + durationMs).toISOString(),
    };
  });
  const { data, error } = await client.rpc("convert_event_to_recurring_series", {
    p_event_id: input.eventId,
    p_parent_updates: input.updates,
    p_child_events: childEvents,
    p_parent_event_date: input.selectedDate.toISOString(),
    p_parent_start_time: input.selectedStartTime,
    p_parent_end_time: input.selectedEndTime,
    p_recurrence_end_date: input.recurrenceEndDate,
  });
  if (error) throw error;
  return (data as { occurrence_count?: number } | null)?.occurrence_count
    ?? input.occurrenceDates.length;
}
