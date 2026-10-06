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

/** Optional canister text: blank becomes null, capped at the canister's 256-char limit. */
export function canisterTitle(value: unknown): string {
  return String(value ?? "").slice(0, 128);
}
/** Required canister text: blank descriptions go as a single space (renders empty). */
export function canisterDescription(value: unknown): string {
  return String(value ?? "").trim().slice(0, 128) || " ";
}
export function optText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 256) : null;
}

export type CreateEventTransactionInput = {
  event: Record<string, unknown>;
  eventDate: string;
  childDates: string[] | null;
  duties: Array<{ name: string; assigned_to: string | null }>;
  /** ICP only: called once background follow-up writes finish. */
  onBackgroundDone?: (failed: number) => void;
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
        title: canisterTitle(eventRecord.title),
        description: canisterDescription(eventRecord.description),
        eventType: String(eventRecord.type ?? "training"),
        location: optText(eventRecord.location_name),
        opponent: optText(eventRecord.opponent),
        address: optText(eventRecord.address),
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
        // Everything after the first occurrence runs in the background with
        // bounded concurrency: each canister update costs ~2s, so awaiting a
        // season of dates + reminders serially kept the button spinning for
        // over a minute. The event page opens as soon as the first exists.
        const dutiesFor = (eventId: string) => input.duties.map((duty) => () =>
          duty.assigned_to
            ? setLiveEventDuty(ctx, eventId, duty.assigned_to, duty.name)
            : createLiveOpenDuty(ctx, eventId, duty.name));
        const childStarts = input.childDates
          .map((d) => occurrenceStartMs(d, startsAtMs))
          .filter((ms) => ms !== startsAtMs);
        runInBackground([
          ...dutiesFor(first.id),
          ...(reminderHours ? [() => setLiveEventAutoReminder(ctx, first.id, reminderHours)] : []),
          ...childStarts.map((childStart) => async () => {
            const occ = await addLiveSeriesOccurrence(ctx, seriesId, childStart, childStart + durationMs);
            if (reminderHours) await setLiveEventAutoReminder(ctx, occ.id, reminderHours);
          }),
        ], input.onBackgroundDone);
        return first.id;
      }

      // No end time (or one before the start) is allowed in the form, but
      // the canister requires end > start — default to a one-hour event.
      const created = await createLiveEvent(ctx, { ...base, startsAtMs, endsAtMs: startsAtMs + durationMs });

      // Best-effort duty sync: the canister has no equivalent of the atomic
      // create_event_with_duties RPC, so duties are written as a separate
      // sequence of calls after the event exists — atomicity with the event
      // create is not guaranteed on ICP. Unassigned duties become open-duty
      // board entries (create_open_duty) rather than being set-duty'd onto an
      // empty account id.
      runInBackground([
        ...input.duties.map((duty) => () =>
          duty.assigned_to
            ? setLiveEventDuty(ctx, created.id, duty.assigned_to, duty.name)
            : createLiveOpenDuty(ctx, created.id, duty.name)),
        ...(reminderHours ? [() => setLiveEventAutoReminder(ctx, created.id, reminderHours)] : []),
      ], input.onBackgroundDone);

      return created.id;
    },
  });
}

/** Runs follow-up canister writes 6 at a time without blocking the caller. */
function runInBackground(
  tasks: Array<() => Promise<unknown>>,
  onDone?: (failed: number) => void,
) {
  if (tasks.length === 0) return;
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try { await task(); } catch (e) { failed++; console.error("Event follow-up write failed:", e); }
    }
  };
  void Promise.all(Array.from({ length: Math.min(6, tasks.length) }, worker)).then(() => onDone?.(failed));
}
