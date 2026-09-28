import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/pitch/PitchBoard", () => ({ default: () => null }));

import {
  getEventLocalDateKey,
  getEventStartMs,
  getLocalDateKey,
  isStillUpcomingForNextUp,
  selectVisibleHomeEvents,
} from "../src/pages/HomePage";

function event(id: string, clubId: string, teamId: string | null, eventDate: string, startTime: string | null = null) {
  return { id, club_id: clubId, team_id: teamId, event_date: eventDate, start_time: startTime } as never;
}

describe("HomePage Next Up characterization", () => {
  afterEach(() => vi.useRealTimers());

  it("uses the viewer's local calendar date rather than a UTC slice", () => {
    expect(getLocalDateKey(new Date(2026, 6, 29, 0, 15, 0))).toBe("2026-07-29");
  });

  it("preserves date-only event values without timezone conversion", () => {
    expect(getEventLocalDateKey("2026-07-29")).toBe("2026-07-29");
  });

  it("converts ISO timestamps to the viewer's local calendar date", () => {
    const instant = "2026-07-29T23:30:00Z";
    expect(getEventLocalDateKey(instant)).toBe(getLocalDateKey(new Date(instant)));
  });

  it("recognises PostgreSQL timestamp strings as absolute instants", () => {
    const instant = "2026-07-29 23:30:00+00";
    expect(getEventLocalDateKey(instant)).toBe(getLocalDateKey(new Date(instant)));
  });

  it("uses a full start_time timestamp when it belongs to the event date", () => {
    const start = "2026-07-29T19:30:00Z";
    expect(getEventStartMs({ event_date: "2026-07-29T00:00:00Z", start_time: start })).toBe(new Date(start).getTime());
  });

  it("combines a time-only start with the event's local date", () => {
    expect(getEventStartMs({ event_date: "2026-07-29", start_time: "19:30" }))
      .toBe(new Date("2026-07-29T19:30").getTime());
  });

  it("trusts a recurring occurrence timestamp over a stale series-template start date", () => {
    const occurrence = "2026-07-29T09:00:00Z";
    expect(getEventStartMs({ event_date: occurrence, start_time: "2026-04-29T09:00:00Z" }))
      .toBe(new Date(occurrence).getTime());
  });

  it("excludes events from a previous local calendar day", () => {
    const now = new Date(2026, 6, 29, 9, 0).getTime();
    expect(isStillUpcomingForNextUp({ event_date: "2026-07-28", start_time: "23:59" }, now)).toBe(false);
  });

  it("keeps today's event through its thirty-minute grace period", () => {
    const start = new Date(2026, 6, 29, 9, 0).getTime();
    expect(isStillUpcomingForNextUp({ event_date: "2026-07-29", start_time: "09:00" }, start + 30 * 60 * 1000)).toBe(true);
  });

  it("removes today's event once the grace period has elapsed", () => {
    const start = new Date(2026, 6, 29, 9, 0).getTime();
    expect(isStillUpcomingForNextUp({ event_date: "2026-07-29", start_time: "09:00" }, start + 30 * 60 * 1000 + 1)).toBe(false);
  });

  it("keeps future-date events even when their time is earlier than today's time", () => {
    const now = new Date(2026, 6, 29, 22, 0).getTime();
    expect(isStillUpcomingForNextUp({ event_date: "2026-07-30", start_time: "07:00" }, now)).toBe(true);
  });
});

describe("HomePage visible event selection", () => {
  const now = new Date(2026, 6, 29, 8, 0).getTime();

  it("preserves backend ordering while limiting the unfiltered dashboard", () => {
    const events = Array.from({ length: 12 }, (_, index) => event(`event-${index}`, index % 2 ? "club-2" : "club-1", null, "2026-07-30"));
    expect(selectVisibleHomeEvents(events, null, now).map((item) => item.id)).toEqual(events.slice(0, 10).map((item) => item.id));
  });

  it("applies the active club before the dashboard limit", () => {
    const events = [...Array.from({ length: 10 }, (_, index) => event(`busy-${index}`, "club-busy", null, "2026-07-30")), event("quiet-fixture", "club-quiet", null, "2026-07-30")];
    expect(selectVisibleHomeEvents(events, "club-quiet", now).map((item) => item.id)).toEqual(["quiet-fixture"]);
  });

  it("removes stale events again when selecting from cached dashboard data", () => {
    const events = [event("past", "club-1", null, "2026-07-28", "09:00"), event("future", "club-1", null, "2026-07-30", "09:00")];
    expect(selectVisibleHomeEvents(events, "club-1", now).map((item) => item.id)).toEqual(["future"]);
  });

  it("does not leak another club's events into an active club view", () => {
    const events = [event("club-one", "club-1", null, "2026-07-30"), event("club-two", "club-2", null, "2026-07-30")];
    expect(selectVisibleHomeEvents(events, "club-1", now).map((item) => item.id)).toEqual(["club-one"]);
  });
});
