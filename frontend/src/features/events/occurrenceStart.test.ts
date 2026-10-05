import { describe, it, expect } from "vitest";
import { occurrenceStartMs } from "./createEventWorkflow";

describe("occurrenceStartMs", () => {
  it("keeps the first event's local time on a date-only occurrence", () => {
    const first = new Date(2026, 9, 6, 17, 30).getTime();
    const d = new Date(occurrenceStartMs("2026-11-03", first));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 3, 17, 30]);
  });
  it("uses an exact timestamp as-is", () => {
    expect(occurrenceStartMs("2026-11-03T08:00:00.000Z", 0)).toBe(Date.parse("2026-11-03T08:00:00.000Z"));
  });
});
