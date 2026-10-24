import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { createLiveEventWithSetup } from "@/live/features/events";

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
  /** Reuse this ID if the outcome of an earlier create is unknown. */
  requestId?: string;
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
        rsvpAudience: (eventRecord.rsvp_audience as string | null | undefined) ?? null,
        adultsOnly: eventRecord.adults_only === true,
        restrictedToRoles: (eventRecord.restricted_to_roles as string[] | null | undefined) ?? null,
        targetTeamIds: (eventRecord.target_team_ids as string[] | null | undefined) ?? null,
      };

      const reminderHours = eventRecord.reminder_hours_before as number | null | undefined;
      const dutyTeamId = eventRecord.duty_team_id as string | null | undefined;
      const durationMs = Math.max(endsAtMs - startsAtMs, 0) || 3_600_000;

      const dates = [...new Set([startsAtMs, ...(input.childDates ?? []).map(d => occurrenceStartMs(d, startsAtMs))])].sort((a, b) => a - b);
      if (dates.some(date => !Number.isFinite(date))) throw new Error("Invalid occurrence date");
      const created = await createLiveEventWithSetup(ctx, {
        ...base, requestId: input.requestId ?? crypto.randomUUID(),
        occurrences: dates.map(date => ({ startsAtMs: date, endsAtMs: date + durationMs })),
        duties: input.duties, dutyTeamId: dutyTeamId ?? null, reminderHours: reminderHours ?? null,
      });
      input.onBackgroundDone?.(0);
      return created.first_event_id;
    },
  }, writeOnce({ clubId: String((input.event as Record<string, unknown>).club_id ?? "") }));
}
