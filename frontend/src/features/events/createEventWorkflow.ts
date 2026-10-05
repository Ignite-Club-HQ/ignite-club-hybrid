import { withFeatureBackend } from "@/live/featureRouter";
import {
  addLiveSeriesOccurrence,
  createLiveEvent,
  createLiveEventSeries,
  createLiveOpenDuty,
  setLiveEventAutoReminder,
  setLiveEventDuty,
} from "@/live/features/events";

/** Start time for a child occurrence: exact date-time, or the date at the first event's local time. */
export function occurrenceStartMs(childDate: string, firstStartMs: number): number {
  if (childDate.includes("T")) return new Date(childDate).getTime();
  const first = new Date(firstStartMs);
  const [y, m, d] = childDate.split("-").map(Number);
  return new Date(y, m - 1, d, first.getHours(), first.getMinutes(), first.getSeconds()).getTime();
}

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
        // The canister rejects empty or >128-char text fields ("Invalid
        // event"/"Invalid series"); an optional blank description is sent as
        // a single space, which renders as empty.
        title: String(eventRecord.title ?? "").slice(0, 128),
        description: String(eventRecord.description ?? "").trim().slice(0, 128) || " ",
        eventType: String(eventRecord.type ?? "training"),
        location: (eventRecord.location_name as string | null | undefined) ?? null,
        opponent: (eventRecord.opponent as string | null | undefined) ?? null,
        address: (eventRecord.address as string | null | undefined) ?? null,
        miniLeagueId: (eventRecord.mini_league_id as string | null | undefined) ?? null,
      };

      const reminderHours = eventRecord.reminder_hours_before as number | null | undefined;
      const durationMs = Math.max(endsAtMs - startsAtMs, 0) || 3_600_000;

      // Recurring: the browser already computed the exact occurrence dates
      // (selected weekdays, calendar months, skipped pauses). Create the
      // series with only the first event, then append each exact date so
      // ICP matches Supabase occurrence-for-occurrence.
      if (input.childDates && input.childDates.length > 0) {
        const { events } = await createLiveEventSeries(ctx, {
          ...base,
          // The canister only accepts daily/weekly/fortnightly/monthly. With
          // untilMs = first start it creates just the first event; the exact
          // dates are appended below, so the frequency value is cosmetic.
          frequency: "weekly",
          firstStartsAtMs: startsAtMs,
          firstEndsAtMs: startsAtMs + durationMs,
          untilMs: startsAtMs,
        });
        const first = events[0];
        if (!first) throw new Error("Event series could not be created.");
        const seriesId = first.series_id?.[0];
        if (!seriesId) throw new Error("Event series could not be created.");
        const occurrenceIds = [first.id];
        for (const childDate of input.childDates) {
          const childStart = occurrenceStartMs(childDate, startsAtMs);
          if (childStart === startsAtMs) continue;
          const occ = await addLiveSeriesOccurrence(ctx, seriesId, childStart, childStart + durationMs);
          occurrenceIds.push(occ.id);
        }
        for (const duty of input.duties) {
          if (duty.assigned_to) {
            await setLiveEventDuty(ctx, first.id, duty.assigned_to, duty.name);
          } else {
            await createLiveOpenDuty(ctx, first.id, duty.name);
          }
        }
        if (reminderHours) {
          for (const occId of occurrenceIds) await setLiveEventAutoReminder(ctx, occId, reminderHours);
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

      if (reminderHours) await setLiveEventAutoReminder(ctx, created.id, reminderHours);

      return created.id;
    },
  });
}
