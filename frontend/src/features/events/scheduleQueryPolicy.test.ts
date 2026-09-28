import { describe, expect, it } from "vitest";
import {
  finalizeScheduleRows,
  getScheduleDateWindow,
  isAbortedScheduleRequest,
  resolveAbortedScheduleRead,
  resolveScheduleReadFailure,
} from "@/features/events/scheduleQueryPolicy";

describe("schedule date window", () => {
  it("uses 30 days back and 45 days ahead for the list", () => {
    expect(getScheduleDateWindow(new Date("2026-08-12T12:00:00Z"), "list", 30))
      .toEqual({ lowerDate: "2026-07-13", upperDate: "2026-09-26" });
  });

  it("expands history on demand and calendar future scope to 240 days", () => {
    expect(getScheduleDateWindow(new Date("2026-08-12T12:00:00Z"), "calendar", 90))
      .toEqual({ lowerDate: "2026-05-14", upperDate: "2027-04-09" });
  });
});

describe("schedule failure fallback", () => {
  it.each([
    [{ name: "AbortError" }],
    [{ message: "The request was aborted" }],
    [{ message: "abort signal fired" }],
  ])("recognises cancelled in-flight requests", (error) => {
    expect(isAbortedScheduleRequest(error)).toBe(true);
  });

  it("does not hide ordinary network or permission failures as aborts", () => {
    expect(isAbortedScheduleRequest({ status: 503, message: "unavailable" })).toBe(false);
    expect(isAbortedScheduleRequest({ code: "42501", message: "denied" })).toBe(false);
  });

  it("uses cache after a database/network result error", () => {
    const cached = [{ id: "cached" }];
    expect(resolveScheduleReadFailure({ status: 503 }, cached)).toBe(cached);
  });

  it("rethrows a result error when no cache exists", () => {
    const denied = { code: "42501", message: "denied" };
    expect(() => resolveScheduleReadFailure(denied, null)).toThrow();
    try { resolveScheduleReadFailure(denied, null); } catch (error) { expect(error).toBe(denied); }
  });

  it("treats an aborted stale request as empty only when no cache exists", () => {
    const cached = [{ id: "cached" }];
    expect(resolveAbortedScheduleRead(cached)).toBe(cached);
    expect(resolveAbortedScheduleRead(null)).toEqual([]);
  });
});

describe("successful schedule finalization", () => {
  const memberships = {
    teamIds: ["team-1"], clubIds: ["club-1"],
    clubAdminClubIds: [], miniLeagueIds: [],
  };

  it("applies cancellation retention, membership visibility and list recurrence policy", () => {
    const now = new Date("2026-08-12T12:00:00Z");
    const rows = [
      { id: "visible", club_id: "club-1", team_id: null, mini_league_id: null, is_cancelled: false, updated_at: now.toISOString(), is_recurring: false, parent_event_id: null, event_date: "2026-08-13" },
      { id: "hidden-club", club_id: "club-9", team_id: null, mini_league_id: null, is_cancelled: false, updated_at: now.toISOString(), is_recurring: false, parent_event_id: null, event_date: "2026-08-13" },
      { id: "old-cancel", club_id: "club-1", team_id: null, mini_league_id: null, is_cancelled: true, updated_at: "2026-08-01T00:00:00Z", is_recurring: false, parent_event_id: null, event_date: "2026-08-13" },
    ];
    expect(finalizeScheduleRows({
      rows, memberships, selectedTeamId: null, selectedMiniLeagueId: null,
      viewMode: "list", now,
    }).map((row) => row.id)).toEqual(["visible"]);
  });
});
