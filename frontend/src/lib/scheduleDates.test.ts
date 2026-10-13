import { describe, expect, it } from "vitest";
import { hasValidScheduleDate, scheduleTimestampDate } from "./scheduleDates";

describe("schedule date validation", () => {
  it("accepts ICP millisecond integers", () => {
    expect(scheduleTimestampDate(1791849600000n)?.toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });
  it.each([1e20, -1e20, Infinity, NaN, "not a date", "", null, undefined])("rejects unrepresentable or missing timestamp %s", (value) => {
    expect(scheduleTimestampDate(value)).toBeNull();
  });
  it("rejects nanoseconds mistakenly stored as milliseconds", () => {
    expect(scheduleTimestampDate(1791849600000000000n)).toBeNull();
  });
  it("accepts calendar dates but rejects malformed cached event dates", () => {
    expect(hasValidScheduleDate({ event_date: "2026-10-13" })).toBe(true);
    expect(hasValidScheduleDate({ event_date: "Invalid Date" })).toBe(false);
    expect(hasValidScheduleDate({ event_date: "2026-02-30" })).toBe(false);
    expect(hasValidScheduleDate({ event_date: null })).toBe(false);
  });
});