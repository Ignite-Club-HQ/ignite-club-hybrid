import { describe, expect, it, vi } from "vitest";
import { readScheduleEvents } from "./scheduleReadRepository";

function clientFor(results: any[]) {
  const selects: string[] = [];
  const filters: unknown[][] = [];
  const from = vi.fn(() => {
    const result = results.shift();
    const query: any = {
      select: (columns: string) => { selects.push(columns); return query; },
      eq: (...args: unknown[]) => { filters.push(args); return query; },
      then: (resolve: any) => Promise.resolve(result).then(resolve),
    };
    return query;
  });
  return { client: { from }, from, selects, filters };
}

describe("Supabase Schedule schema compatibility", () => {
  it("loads existing events when duty_team_id is absent, retaining the club filter", async () => {
    const mock = clientFor([
      { data: null, error: { code: "42703", message: "column events.duty_team_id does not exist" } },
      { data: [{ id: "event-1", club_id: "club-1" }], error: null },
    ]);
    const result = await readScheduleEvents(mock.client, q => q.eq("club_id", "club-1"));
    expect(result.data).toEqual([{ id: "event-1", club_id: "club-1", duty_team_id: null }]);
    expect(mock.filters).toEqual([["club_id", "club-1"], ["club_id", "club-1"]]);
    expect(mock.selects[0]).toContain("duty_team_id");
    expect(mock.selects[1]).not.toContain("duty_team_id");
  });

  it("preserves duty teams on upgraded deployments without retrying", async () => {
    const rows = [{ id: "event-1", duty_team_id: "team-1" }];
    const mock = clientFor([{ data: rows, error: null }]);
    expect((await readScheduleEvents(mock.client, q => q)).data).toBe(rows);
    expect(mock.from).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: "42501", message: "permission denied" },
    { code: "42703", message: "column events.other_column does not exist" },
    { code: "", message: "Failed to fetch" },
  ])("does not retry or hide other failures: $message", async error => {
    const mock = clientFor([{ data: null, error }]);
    expect((await readScheduleEvents(mock.client, q => q)).error).toBe(error);
    expect(mock.from).toHaveBeenCalledTimes(1);
  });
});