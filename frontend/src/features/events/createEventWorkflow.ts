import { withFeatureBackend } from "@/live/featureRouter";
import { createLiveEvent, createLiveEventSeries, createLiveOpenDuty, setLiveEventDuty } from "@/live/features/events";

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
      const base = {
        clubId: String(eventRecord.club_id ?? ""),
        teamId: (eventRecord.team_id as string | null | undefined) ?? null,
        title: String(eventRecord.title ?? ""),
        description: String(eventRecord.description ?? ""),
        eventType: String(eventRecord.type ?? "training"),
        location: (eventRecord.location_name as string | null | undefined) ?? null,
        opponent: (eventRecord.opponent as string | null | undefined) ?? null,
        address: (eventRecord.address as string | null | undefined) ?? null,
        miniLeagueId: (eventRecord.mini_league_id as string | null | undefined) ?? null,
      };

      // Recurring: the canister expands the series itself. Provisional —
      // input.childDates is the browser-computed occurrence list; we derive
      // the frequency from the median gap (weekly/fortnightly/monthly) and
      // the end from the last occurrence rather than passing dates through.
      if (input.childDates && input.childDates.length > 0) {
        const gaps = input.childDates
          .slice(0, 4)
          .map((d) => Math.round((new Date(d).getTime() - startsAtMs) / 86_400_000));
        const step = gaps[0] ?? 7;
        const frequency = step <= 1 ? "daily" : step <= 7 ? "weekly" : step <= 14 ? "fortnightly" : "monthly";
        const untilMs = new Date(input.childDates[input.childDates.length - 1]).getTime();
        const { events } = await createLiveEventSeries(ctx, {
          ...base,
          frequency,
          firstStartsAtMs: startsAtMs,
          firstEndsAtMs: endsAtMs,
          untilMs,
        });
        const first = events[0];
        if (!first) throw new Error("Event series could not be created.");
        for (const duty of input.duties) {
          if (duty.assigned_to) {
            await setLiveEventDuty(ctx, first.id, duty.assigned_to, duty.name);
          } else {
            await createLiveOpenDuty(ctx, first.id, duty.name);
          }
        }
        return first.id;
      }

      const created = await createLiveEvent(ctx, { ...base, startsAtMs, endsAtMs });

      // Best-effort duty sync: the canister has no equivalent of the atomic
      // create_event_with_duties RPC, so duties are written as a separate
      // sequence of calls after the event exists — atomicity with the event
      // create is not guaranteed on ICP. Unassigned duties become open-duty
      // board entries (create_open_duty) rather than being set-duty'd onto an
      // empty account id.
      for (const duty of input.duties) {
        if (duty.assigned_to) {
          await setLiveEventDuty(ctx, created.id, duty.assigned_to, duty.name);
        } else {
          await createLiveOpenDuty(ctx, created.id, duty.name);
        }
      }

      return created.id;
    },
  });
}
