import { canisterDescription, canisterTitle, optText } from "./createEventWorkflow";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  createLiveOpenDuty,
  createLiveRecurringEventSeries,
  getLiveEventsSnapshot,
  setLiveEventDuty,
  updateLiveEvent,
  updateLiveEventSeries,
} from "@/live/features/events";

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
  /**
   * User-selected recurrence cadence from EditEventPage's recurrence
   * selector ("daily" | "weekly" | "biweekly" | "monthly"). Supabase ignores
   * this (occurrenceDates already reflect the pattern); the ICP branch maps
   * it onto the canister's frequency vocabulary, which spells the two-week
   * cadence "fortnightly" rather than "biweekly" — provisional mapping,
   * verify against the live events_domain canister's accepted frequency
   * strings post-deploy.
   */
  frequency: "daily" | "weekly" | "biweekly" | "monthly";
};

/**
 * Persist either the selected occurrence or its entire existing series while
 * preserving the established database contracts.
 */
export async function updateEventTransaction(
  client: any,
  input: EventUpdateTransactionInput,
): Promise<void> {
  return withFeatureBackend("events", {
    supabase: async () => {
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
    },
    icp: async (ctx) => {
      if (input.updateSeries) {
        // Canister counterpart of update_event_series: find the series this
        // event belongs to via the snapshot, then rewrite future occurrences
        // from the selected date. Provisional — the canister series carries
        // title/description/type/location only; per-occurrence time changes
        // are not replayed (children keep the series' original times).
        const snapshot = await getLiveEventsSnapshot(ctx);
        const event = (snapshot.events as Array<{ id: string; series_id: [] | [string] }>)
          .find((e) => e.id === input.eventId);
        const seriesId = event?.series_id?.[0];
        if (!seriesId) throw new Error("Event is not part of a recurring series.");
        const updates = input.updates as Record<string, unknown>;
        const current = (snapshot.series as Array<{ id: string; title: string; description: string; event_type: string; location: [] | [string] }>)
          .find((s) => s.id === seriesId);
        await updateLiveEventSeries(ctx, seriesId, {
          title: canisterTitle(updates.title ?? current?.title),
          description: canisterDescription(updates.description ?? current?.description),
          eventType: String(updates.type ?? current?.event_type ?? "training"),
          location: optText(updates.address ?? updates.location_name ?? current?.location?.[0]),
          fromMs: new Date(input.selectedEventDate).getTime(),
        });
        return;
      }

      // Provisional mapping: `updates` carries Supabase column names
      // (title/description) — verify against the live events_domain schema
      // post-deploy. Since the canister update_event call replaces the full
      // record, fields missing from `updates` fall back to empty strings
      // rather than a fetch-modify-save round trip.
      const updates = input.updates as Record<string, unknown>;
      const startsAtMs = new Date(input.selectedStartTime ?? input.selectedEventDate).getTime();
      const endsAtMs = new Date(input.selectedEndTime ?? input.selectedEventDate).getTime();
      await updateLiveEvent(ctx, input.eventId, {
        title: canisterTitle(updates.title),
        description: canisterDescription(updates.description),
        eventType: String(updates.type ?? "training"),
        location: optText(updates.location_name),
        opponent: optText(updates.opponent),
        address: optText(updates.address),
        miniLeagueId: (updates.mini_league_id as string | null | undefined) ?? null,
        startsAtMs,
        // The canister requires end > start; no/invalid end -> one hour.
        endsAtMs: endsAtMs > startsAtMs ? endsAtMs : startsAtMs + 3_600_000,
      });
      if ("reminder_hours_before" in updates) {
        const { setLiveEventAutoReminder } = await import("@/live/features/events");
        const hours = updates.reminder_hours_before as number | null | undefined;
        await setLiveEventAutoReminder(ctx, input.eventId, hours ?? null);
      }
    },
  });
}

/** Apply all duty additions, edits and removals using the existing atomic RPC. */
export async function syncEventDuties(
  client: any,
  eventId: string,
  deleteIds: string[],
  duties: EventDutyInput[],
): Promise<Array<{ idx: number; id: string }>> {
  return withFeatureBackend("events", {
    supabase: async () => {
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
    },
    icp: async (ctx) => {
      // Best-effort sequence: the canister has one set_duty(event, account,
      // duty) call and no batch/delete-duty shape, so duty removals
      // (deleteIds) stay Supabase-only — no canister shape for deletion.
      // Atomicity with the Supabase RPC's single-transaction guarantee is
      // not preserved here. Unassigned duties become open-duty board entries
      // (create_open_duty) instead of a set-duty call with an empty account.
      for (const [idx, duty] of duties.entries()) {
        if (duty.assignedTo) {
          await setLiveEventDuty(ctx, eventId, duty.assignedTo, duty.name);
        } else {
          await createLiveOpenDuty(ctx, eventId, duty.name);
        }
        void idx;
      }
      return [];
    },
  });
}

/**
 * Convert an existing single event into a recurring parent and its children.
 *
 * Supabase delegates parent conversion and child insertion to one database
 * transaction. On ICP the canister creates the series (with the converted
 * event's details as the first occurrence); the original single event is
 * left in place — provisional mapping, verify post-deploy whether the
 * original should be cancelled or absorbed.
 */
export async function convertEventToRecurringSeries(
  client: any,
  input: RecurringConversionInput,
): Promise<number> {
  const durationMs = input.selectedEndTime
    ? new Date(input.selectedEndTime).getTime() - input.selectedDate.getTime()
    : null;
  return withFeatureBackend("events", {
    supabase: async () => {
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
    },
    icp: async (ctx) => {
      const updates = input.updates as Record<string, unknown>;
      const untilMs = new Date(input.recurrenceEndDate).getTime();
      const firstStartsAtMs = input.selectedDate.getTime();
      const { events } = await createLiveRecurringEventSeries(ctx, {
        clubId: String(updates.club_id ?? ""),
        teamId: (updates.team_id as string | null | undefined) ?? null,
        title: canisterTitle(updates.title),
        description: canisterDescription(updates.description),
        eventType: String(updates.type ?? "training"),
        location: optText(updates.location_name),
        // Canister vocabulary uses "fortnightly" instead of "biweekly".
        frequency: input.frequency === "biweekly" ? "fortnightly" : input.frequency,
        firstStartsAtMs,
        firstEndsAtMs: firstStartsAtMs + (durationMs && durationMs > 0 ? durationMs : 3_600_000),
        untilMs,
      });
      return events.length;
    },
  });
}
