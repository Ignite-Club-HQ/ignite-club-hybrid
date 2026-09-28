import { describe, expect, it, vi } from "vitest";
import {
  fetchEventPayments,
  fetchMatchCaptain,
  fetchMatchGoalkeepers,
  fetchPlayerOfMatch,
} from "@/features/events/eventPaymentAwardRepository";

function clientResult(tableResults: Record<string, { data: any; error?: any }>) {
  const calls: Array<{ table: string; select: string; eventId: string; single: boolean }> = [];
  const from = vi.fn((table: string) => {
    let projection = "";
    let eventId = "";
    const result = () => ({
      data: tableResults[table]?.data ?? null,
      error: tableResults[table]?.error ?? null,
    });
    const query: any = {
      select: vi.fn((value: string) => { projection = value; return query; }),
      eq: vi.fn((column: string, value: string) => {
        expect(column).toBe("event_id");
        eventId = value;
        return query;
      }),
      maybeSingle: vi.fn(async () => {
        calls.push({ table, select: projection, eventId, single: true });
        return result();
      }),
      then: (resolve: any) => {
        calls.push({ table, select: projection, eventId, single: false });
        return Promise.resolve(result()).then(resolve);
      },
    };
    return query;
  });
  return { client: { from }, calls };
}

describe("event payment reads", () => {
  it("returns paid user markers for exactly one event", async () => {
    const rows = [{ user_id: "adult-1" }];
    const db = clientResult({ event_payments: { data: rows } });
    await expect(fetchEventPayments(db.client, "event-1")).resolves.toBe(rows);
    expect(db.calls).toContainEqual({
      table: "event_payments", select: "user_id", eventId: "event-1", single: false,
    });
  });

  it("propagates payment permission failures instead of returning unpaid", async () => {
    const denied = { code: "42501", message: "denied" };
    const db = clientResult({ event_payments: { data: null, error: denied } });
    await expect(fetchEventPayments(db.client, "event-1")).rejects.toBe(denied);
  });
});

describe("event match marker reads", () => {
  it("reads captain, player-of-match and all goalkeeper markers in event scope", async () => {
    const captain = { user_id: "captain", child_id: null };
    const potm = { user_id: null, child_id: "child-potm" };
    const keepers = [{ user_id: "keeper", child_id: null }];
    const db = clientResult({
      match_captains: { data: captain },
      player_of_match: { data: potm },
      match_goalkeepers: { data: keepers },
    });

    await expect(fetchMatchCaptain(db.client, "event-1")).resolves.toBe(captain);
    await expect(fetchPlayerOfMatch(db.client, "event-1")).resolves.toBe(potm);
    await expect(fetchMatchGoalkeepers(db.client, "event-1")).resolves.toBe(keepers);
    expect(db.calls).toEqual(expect.arrayContaining([
      { table: "match_captains", select: "user_id, child_id", eventId: "event-1", single: true },
      { table: "player_of_match", select: "user_id, child_id", eventId: "event-1", single: true },
      { table: "match_goalkeepers", select: "user_id, child_id", eventId: "event-1", single: false },
    ]));
  });

  it("returns null/empty only for successful missing marker reads", async () => {
    const db = clientResult({
      match_captains: { data: null },
      player_of_match: { data: null },
      match_goalkeepers: { data: null },
    });
    await expect(fetchMatchCaptain(db.client, "event-1")).resolves.toBeNull();
    await expect(fetchPlayerOfMatch(db.client, "event-1")).resolves.toBeNull();
    await expect(fetchMatchGoalkeepers(db.client, "event-1")).resolves.toEqual([]);
  });

  it.each([
    ["captain", fetchMatchCaptain, "match_captains"],
    ["player of match", fetchPlayerOfMatch, "player_of_match"],
    ["goalkeepers", fetchMatchGoalkeepers, "match_goalkeepers"],
  ] as const)("propagates %s read failures", async (_label, reader, table) => {
    const unavailable = { status: 503, message: "unavailable" };
    const db = clientResult({ [table]: { data: null, error: unavailable } });
    await expect(reader(db.client, "event-1")).rejects.toBe(unavailable);
  });
});
