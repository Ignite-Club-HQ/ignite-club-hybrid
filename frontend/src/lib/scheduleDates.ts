import { isValid, parseISO } from "date-fns";

/** Finite numbers can still be outside JavaScript's representable date range. */
export function scheduleTimestampDate(value: unknown): Date | null {
  if (typeof value !== "number" && typeof value !== "bigint" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  return isValid(date) ? date : null;
}

export function hasValidScheduleDate(event: { event_date?: unknown }): boolean {
  return typeof event.event_date === "string" && isValid(parseISO(event.event_date));
}