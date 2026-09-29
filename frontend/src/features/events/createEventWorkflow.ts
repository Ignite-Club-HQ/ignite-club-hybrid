import { withFeatureBackend } from "@/live/featureRouter";
import { createLiveEvent, setLiveEventDuty } from "@/live/features/events";

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
  return withFeatureBackend("events", {
    supabase: async () => {
      const { data: eventId, error } = await client.rpc("create_event_with_duties", {
        p_event: { ...input.event, event_date: input.eventDate },
        p_child_dates: input.childDates,
        p_duties: input.duties,
      });
      if (error) throw error;
      if (!eventId) throw new Error("Event could not be created.");
      return eventId;
    },
    icp: async (ctx) => {
      // Provisional mapping: input.event carries Supabase column names
      // (club_id/team_id/description/end_time) — verify field names against
      // the live events_domain schema post-deploy.
      const eventRecord = input.event as Record<string, unknown>;
      const startsAtMs = new Date(input.eventDate).getTime();
      const endTime = eventRecord.end_time as string | undefined;
      const endsAtMs = endTime ? new Date(endTime).getTime() : startsAtMs;
      const created = await createLiveEvent(ctx, {
        clubId: String(eventRecord.club_id ?? ""),
        teamId: (eventRecord.team_id as string | null | undefined) ?? null,
        title: String(eventRecord.title ?? ""),
        description: String(eventRecord.description ?? ""),
        startsAtMs,
        endsAtMs,
      });

      // Best-effort duty sync: the canister has no equivalent of the atomic
      // create_event_with_duties RPC, so duties are written as a separate
      // sequence of calls after the event exists — atomicity with the event
      // create is not guaranteed on ICP.
      for (const duty of input.duties) {
        await setLiveEventDuty(ctx, created.id, duty.assigned_to ?? "", duty.name);
      }

      // stays Supabase: no canister shape for recurring series expansion
      // (childDates) — this is handled entirely inside the Supabase RPC.

      return created.id;
    },
  });
}
