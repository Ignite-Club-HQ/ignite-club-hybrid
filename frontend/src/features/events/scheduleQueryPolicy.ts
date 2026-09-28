import { filterRecurringEvents } from "@/lib/filterRecurringEvents";
import {
  filterVisibleScheduleEvents,
  retainRecentlyCancelledEvents,
  type ScheduleEventScope,
  type ScheduleMembershipScope,
} from "@/features/events/scheduleVisibilityPolicy";

export function getScheduleDateWindow(
  now: Date,
  viewMode: "list" | "calendar",
  pastDaysBack: number,
) {
  const lower = new Date(now);
  lower.setDate(lower.getDate() - Math.max(30, pastDaysBack));
  const upper = new Date(now);
  upper.setDate(upper.getDate() + (viewMode === "calendar" ? 240 : 45));
  return {
    lowerDate: lower.toISOString().split("T")[0],
    upperDate: upper.toISOString().split("T")[0],
  };
}

export function isAbortedScheduleRequest(error: unknown): boolean {
  const candidate = error as any;
  return candidate?.name === "AbortError" || /aborted|abort/i.test(String(candidate?.message || ""));
}

export function resolveScheduleReadFailure<T>(
  error: unknown,
  cached: T[] | null | undefined,
): T[] {
  if (cached) return cached;
  throw error;
}

export function resolveAbortedScheduleRead<T>(cached: T[] | null | undefined): T[] {
  return cached ?? [];
}

export function finalizeScheduleRows<T extends ScheduleEventScope>(args: {
  rows: T[];
  memberships: ScheduleMembershipScope;
  selectedTeamId: string | null;
  selectedMiniLeagueId: string | null;
  viewMode: "list" | "calendar";
  now: Date;
}): T[] {
  const retained = retainRecentlyCancelledEvents(args.rows, args.now);
  const visible = filterVisibleScheduleEvents(
    retained,
    args.memberships,
    args.selectedTeamId,
    args.selectedMiniLeagueId,
  );
  return args.viewMode === "calendar"
    ? visible
    : (filterRecurringEvents(visible as any[]) as T[]);
}
