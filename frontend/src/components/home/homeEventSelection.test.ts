import { describe, expect, it } from "vitest";
import {
  getEventStartMs,
  isStillUpcomingForNextUp,
  selectVisibleHomeEvents,
} from "./homeEventSelection";

describe("homeEventSelection", () => {
  it("combines a time-only start with the event date", () => {
    expect(
      getEventStartMs({
        event_date: "2026-09-14",
        start_time: "19:30",
      }),
    ).toBe(new Date("2026-09-14T19:30").getTime());
  });

  it("uses the occurrence timestamp when a recurring template date is stale", () => {
    expect(
      getEventStartMs({
        event_date: "2026-09-14T19:30:00+10:00",
        start_time: "2026-08-01T19:30:00+10:00",
      }),
    ).toBe(new Date("2026-09-14T19:30:00+10:00").getTime());
  });

  it("keeps today's event visible through its thirty-minute grace period", () => {
    const kickoff = new Date(2026, 8, 14, 19, 30).getTime();
    expect(
      isStillUpcomingForNextUp(
        { event_date: "2026-09-14", start_time: "19:30" },
        kickoff + 29 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      isStillUpcomingForNextUp(
        { event_date: "2026-09-14", start_time: "19:30" },
        kickoff + 31 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("filters by active club before applying the result limit", () => {
    const now = new Date(2026, 8, 14, 10).getTime();
    const events = [
      { event_date: "2026-09-15", club_id: "other", id: "other" },
      { event_date: "2026-09-16", club_id: "club-1", id: "first" },
      { event_date: "2026-09-17", club_id: "club-1", id: "second" },
    ];
    expect(selectVisibleHomeEvents(events, "club-1", now, 1)).toEqual([
      events[1],
    ]);
  });
});
