import { describe, expect, it } from "vitest";
import {
  alignEditedEventTimes,
  generateRecurringDates,
  recurringChildTimestamps,
  timeOnEventDate,
} from "@/features/events/eventRecurrencePolicy";

const iso = (value: string) => new Date(value);

describe("event timestamp alignment", () => {
  it("places a bare time on the event date", () => {
    expect(timeOnEventDate("14:35", iso("2026-08-12T09:00:00Z")))
      .toBe("2026-08-12T14:35:00.000Z");
    expect(timeOnEventDate("", iso("2026-08-12T09:00:00Z"))).toBeNull();
    expect(timeOnEventDate("bad", iso("2026-08-12T09:00:00Z"))).toBeNull();
  });

  it("preserves a valid original duration when an event date moves", () => {
    expect(alignEditedEventTimes(
      iso("2026-09-01T10:00:00Z"),
      "2026-08-12T09:00:00Z",
      "2026-08-12T10:30:00Z",
    )).toEqual({
      startTime: "2026-09-01T10:00:00.000Z",
      endTime: "2026-09-01T11:30:00.000Z",
    });
  });

  it("does not invent an end time from invalid duration data", () => {
    expect(alignEditedEventTimes(iso("2026-09-01T10:00:00Z"), "bad", "bad").endTime)
      .toBeNull();
  });
});

describe("recurrence generation", () => {
  it.each([
    ["daily", 1, [], ["2026-08-12", "2026-08-13", "2026-08-14"]],
    ["weekly", 1, [], [
      "2026-08-12", "2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09",
      "2026-09-16", "2026-09-23", "2026-09-30", "2026-10-07",
    ]],
    ["biweekly", 1, [], [
      "2026-08-12", "2026-08-26", "2026-09-09", "2026-09-23", "2026-10-07",
    ]],
    ["monthly", 1, [], ["2026-08-12", "2026-09-12", "2026-10-12"]],
  ] as const)("generates %s dates inclusively", (pattern, interval, weekdays, expected) => {
    const dates = generateRecurringDates({
      startDate: iso("2026-08-12T09:00:00Z"), endDate: iso("2026-10-12T09:00:00Z"),
      pattern, interval, weekdays: [...weekdays],
    }).map((date) => date.toISOString().slice(0, 10));
    if (pattern === "daily") expect(dates.slice(0, 3)).toEqual(expected);
    else expect(dates).toEqual(expected);
  });

  it("honours selected weekdays for weekly recurrence", () => {
    expect(generateRecurringDates({
      startDate: iso("2026-08-10T09:00:00Z"), endDate: iso("2026-08-17T09:00:00Z"),
      pattern: "weekly", interval: 1, weekdays: [3, 5],
    }).map((date) => date.toISOString().slice(0, 10))).toEqual([
      "2026-08-10", "2026-08-12", "2026-08-14",
    ]);
  });

  it("returns null when a series has no child occurrence", () => {
    expect(recurringChildTimestamps({
      startDate: iso("2026-08-12T09:00:00Z"), endDate: iso("2026-08-12T09:00:00Z"),
      pattern: "daily", interval: 1, weekdays: [],
    })).toBeNull();
  });
});
