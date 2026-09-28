export type RecurrencePattern = "daily" | "weekly" | "biweekly" | "monthly";

export function timeOnEventDate(
  time: string | null | undefined,
  eventDate: Date,
): string | null {
  if (!time) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  const date = new Date(eventDate);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

export function generateRecurringDates(args: {
  startDate: Date;
  endDate: Date;
  pattern: RecurrencePattern;
  interval: number;
  weekdays: number[];
}): Date[] {
  const dates = [new Date(args.startDate)];
  let currentDate = new Date(args.startDate);

  while (currentDate < args.endDate) {
    if (args.pattern === "daily") {
      currentDate = new Date(currentDate.setDate(currentDate.getDate() + args.interval));
    } else if (args.pattern === "weekly") {
      if (args.weekdays.length > 0) {
        let found = false;
        for (let i = 1; i <= 7 * args.interval && !found; i++) {
          const nextDate = new Date(currentDate);
          nextDate.setDate(nextDate.getDate() + i);
          if (args.weekdays.includes(nextDate.getDay())) {
            currentDate = nextDate;
            found = true;
          }
        }
        if (!found) break;
      } else {
        currentDate = new Date(currentDate.setDate(currentDate.getDate() + 7 * args.interval));
      }
    } else if (args.pattern === "biweekly") {
      currentDate = new Date(currentDate.setDate(currentDate.getDate() + 14 * args.interval));
    } else {
      currentDate = new Date(currentDate.setMonth(currentDate.getMonth() + args.interval));
    }

    if (currentDate <= args.endDate) dates.push(new Date(currentDate));
  }
  return dates;
}

export function recurringChildTimestamps(args: Parameters<typeof generateRecurringDates>[0]) {
  const dates = generateRecurringDates(args).slice(1).map((date) => {
    const aligned = new Date(date);
    aligned.setHours(args.startDate.getHours(), args.startDate.getMinutes());
    return aligned.toISOString();
  });
  return dates.length > 0 ? dates : null;
}

export function alignEditedEventTimes(
  selectedDate: Date,
  originalStart: string | null | undefined,
  originalEnd: string | null | undefined,
) {
  const startTime = selectedDate.toISOString();
  let endTime: string | null = null;
  if (originalStart && originalEnd) {
    const durationMs = new Date(originalEnd).getTime() - new Date(originalStart).getTime();
    if (Number.isFinite(durationMs) && durationMs > 0) {
      endTime = new Date(selectedDate.getTime() + durationMs).toISOString();
    }
  } else if (originalEnd) {
    endTime = originalEnd;
  }
  return { startTime, endTime };
}
