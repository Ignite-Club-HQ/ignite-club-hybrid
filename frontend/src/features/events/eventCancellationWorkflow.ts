export class SeriesCancellationPartialError extends Error {
  constructor(
    public childrenCommitted: boolean,
    public parentCommitted: boolean,
    public underlying: string,
  ) {
    super(underlying);
    this.name = "SeriesCancellationPartialError";
  }
}

const cancellationUpdate = { is_cancelled: true, chat_cancel_post_handled: true };

export async function cancelEventRows(
  client: any,
  input: {
    eventId: string;
    cancelType: "single" | "series";
    isRecurring: boolean;
    parentEventId?: string | null;
  },
): Promise<void> {
  const isSeries = input.cancelType === "series" && (!!input.parentEventId || input.isRecurring);
  if (!isSeries) {
    const { error } = await client.from("events").update(cancellationUpdate).eq("id", input.eventId);
    if (error) throw error;
    return;
  }

  const rootId = input.parentEventId || input.eventId;
  const { error: childrenError } = await client
    .from("events").update(cancellationUpdate).eq("parent_event_id", rootId);
  const { error: parentError } = await client
    .from("events").update(cancellationUpdate).eq("id", rootId);

  const childrenCommitted = !childrenError;
  const parentCommitted = !parentError;
  if (!childrenCommitted && !parentCommitted) throw childrenError ?? parentError;
  if (!childrenCommitted || !parentCommitted) {
    throw new SeriesCancellationPartialError(
      childrenCommitted,
      parentCommitted,
      (childrenError ?? parentError)?.message ?? "Series cancellation failed",
    );
  }
}
