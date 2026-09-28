import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  isSameWeek,
  isToday,
  isTomorrow,
  parseISO,
  startOfDay,
} from "date-fns";

const weekOptions = { weekStartsOn: 1 as const };

type RelativeWeekdayQualifier = "this" | "next" | null;

function getImmediateUpcomingWeekday(date: Date, now: Date) {
  const currentDay = startOfDay(now);
  const daysUntilWeekday = (date.getDay() - currentDay.getDay() + 7) % 7 || 7;

  return addDays(currentDay, daysUntilWeekday);
}

function getRelativeWeekdayQualifier(date: Date, now: Date): RelativeWeekdayQualifier {
  if (date <= now) {
    return null;
  }

  const immediateUpcomingWeekday = getImmediateUpcomingWeekday(date, now);

  if (!isSameDay(date, immediateUpcomingWeekday)) {
    return null;
  }

  return isSameWeek(date, now, weekOptions) ? "this" : "next";
}

export function formatEventContextualDate(dateStr: string) {
  const date = parseISO(dateStr);
  const now = new Date();
  const time = format(date, "h:mm a");

  if (isToday(date)) {
    return { label: "Today", time };
  }

  if (isTomorrow(date)) {
    return { label: "Tomorrow", time };
  }

  const qualifier = getRelativeWeekdayQualifier(date, now);

  if (qualifier === "this") {
    return { label: `This ${format(date, "EEEE")}`, time };
  }

  if (qualifier === "next") {
    return { label: `Next ${format(date, "EEEE")}`, time };
  }

  return { label: format(date, "EEE, MMM d"), time };
}

/**
 * Compact single-line date+time used on event cards.
 * Examples: "Today · 3:50 PM", "Tomorrow · 3:50 PM", "Wed · 3:45 PM",
 * "This Tuesday · 7:00 PM", "Sat 14 Jun · 10:00 AM" (further out).
 *
 * Keeps the date context next to the time so users get instant when-recognition
 * without the previously redundant standalone urgency chip on the card.
 */
export function formatCompactDateTime(dateStr: string): string {
  const date = parseISO(dateStr);
  const now = new Date();
  const time = format(date, "h:mm a");

  if (isToday(date)) return `Today · ${time}`;
  if (isTomorrow(date)) return `Tomorrow · ${time}`;

  const qualifier = getRelativeWeekdayQualifier(date, now);
  if (qualifier === "this") return `This ${format(date, "EEEE")} · ${time}`;
  if (qualifier === "next") return `Next ${format(date, "EEEE")} · ${time}`;

  // Far out: "Sat 14 Jun · 10:00 AM" — short weekday + day + month
  return `${format(date, "EEE d MMM")} · ${time}`;
}

export function getEventUrgencyBadge(dateStr: string) {
  const date = parseISO(dateStr);
  const now = new Date();
  const daysAway = differenceInCalendarDays(date, now);

  if (isToday(date)) {
    return { text: "🔴 Today", className: "bg-destructive/15 text-destructive border-destructive/30" };
  }

  if (isTomorrow(date)) {
    return { text: "⏳ Tomorrow", className: "bg-warning/15 text-warning border-warning/30" };
  }

  if (daysAway === 2) {
    return { text: "⏳ In 2 days", className: "bg-warning/10 text-warning border-warning/20" };
  }

  const qualifier = getRelativeWeekdayQualifier(date, now);

  if (qualifier === "this") {
    return {
      text: `📅 This ${format(date, "EEEE")}`,
      className: "bg-primary/10 text-primary border-primary/20",
    };
  }

  if (qualifier === "next") {
    return {
      text: `📅 Next ${format(date, "EEEE")}`,
      className: "bg-muted text-muted-foreground border-border",
    };
  }

  return null;
}