import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type EventRow = { id: string; event_date: string };

// Per-test state
let eventsRows: EventRow[] = [];
let activeGameRow: { pitch_state: { linkedEventId?: string | null } } | null = null;
let linkedEventRow: { event_date: string; is_cancelled: boolean } | null = null;
let eventsError: unknown = null;

function makeEventsBuilder() {
  const builder: any = {
    _rows: () => eventsRows,
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (v: { data: EventRow[] | null; error: unknown }) => void) =>
      resolve({ data: eventsError ? null : eventsRows, error: eventsError }),
  };
  return builder;
}

function makeActiveGamesBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: activeGameRow, error: null }),
  };
  return builder;
}

function makeSingleEventBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: linkedEventRow, error: null }),
  };
  return builder;
}

// Route "events" table to either the multi-row builder (for search) or the
// single-row builder (for linked-event verification), based on call ordering.
let eventsCallCount = 0;
let expectSingleEventFetch = false;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "active_games") return makeActiveGamesBuilder();
      if (table === "events") {
        eventsCallCount += 1;
        if (expectSingleEventFetch && eventsCallCount === 1) {
          return makeSingleEventBuilder();
        }
        return makeEventsBuilder();
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

import { findNearbyGameEvent } from "./useNearbyGameEvent";

const TEAM_ID = "team-1";
const NOW = new Date("2026-07-20T12:00:00.000Z").getTime();

function iso(offsetMinutes: number) {
  return new Date(NOW + offsetMinutes * 60_000).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  eventsRows = [];
  activeGameRow = null;
  linkedEventRow = null;
  eventsError = null;
  eventsCallCount = 0;
  expectSingleEventFetch = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("findNearbyGameEvent — temporal closeness", () => {
  it("must select the temporally closest eligible game, not simply the oldest", async () => {
    eventsRows = [
      { id: "A", event_date: iso(-170) }, // started 170 min ago
      { id: "B", event_date: iso(10) }, // starts in 10 min
    ];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("B");
  });

  it("prefers a close past event over a distant upcoming event", async () => {
    eventsRows = [
      { id: "past-close", event_date: iso(-5) },
      { id: "future-far", event_date: iso(115) },
    ];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("past-close");
  });

  it("prefers a recent past event over a much closer upcoming event when upcoming is closer", async () => {
    eventsRows = [
      { id: "past-far", event_date: iso(-160) },
      { id: "future-close", event_date: iso(5) },
    ];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("future-close");
  });

  it("prefers the upcoming event when past and future are equally distant", async () => {
    eventsRows = [
      { id: "past", event_date: iso(-30) },
      { id: "future", event_date: iso(30) },
    ];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("future");
  });

  it("selects the nearest of multiple upcoming events", async () => {
    eventsRows = [
      { id: "u-far", event_date: iso(90) },
      { id: "u-near", event_date: iso(15) },
      { id: "u-mid", event_date: iso(45) },
    ];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("u-near");
  });

  it("selects the nearest of multiple past events", async () => {
    eventsRows = [
      { id: "p-far", event_date: iso(-150) },
      { id: "p-near", event_date: iso(-20) },
      { id: "p-mid", event_date: iso(-60) },
    ];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("p-near");
  });

  it("ignores invalid event_date values without crashing", async () => {
    eventsRows = [
      { id: "bad", event_date: "not-a-date" },
      { id: "good", event_date: iso(20) },
    ];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("good");
  });

  it("uses stable secondary tie-breaking when timestamps are identical", async () => {
    eventsRows = [
      { id: "zzz", event_date: iso(10) },
      { id: "aaa", event_date: iso(10) },
      { id: "mmm", event_date: iso(10) },
    ];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("aaa");
  });

  it("returns null when no eligible events exist", async () => {
    eventsRows = [];
    expect(await findNearbyGameEvent(TEAM_ID)).toBeNull();
  });

  it("returns null when the lookup fails", async () => {
    eventsError = { message: "boom" };
    expect(await findNearbyGameEvent(TEAM_ID)).toBeNull();
  });

  it("still prefers a valid linked active game over the fallback window search", async () => {
    activeGameRow = { pitch_state: { linkedEventId: "linked-1" } };
    linkedEventRow = { event_date: iso(5), is_cancelled: false };
    expectSingleEventFetch = true;
    eventsRows = [{ id: "future-closer", event_date: iso(1) }];
    expect(await findNearbyGameEvent(TEAM_ID)).toBe("linked-1");
  });
});
