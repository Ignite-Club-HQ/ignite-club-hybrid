import { describe, expect, it } from "vitest";
import { completeEventDuty, DutyNotificationPartialError } from "./eventDutyCompletionWorkflow";

type Result = { data: any; error: any };

function clientWith(results: Record<string, Result[]>) {
  const operations: any[] = [];
  const take = (key: string) => results[key]?.shift() ?? { data: [], error: null };
  const from = (table: string) => {
    let operation = "select";
    let payload: any;
    const filters: any[] = [];
    const builder: any = {
      update(value: any) { operation = "update"; payload = value; return builder; },
      select() { return builder; },
      insert(value: any) {
        operations.push({ table, operation: "insert", payload: value, filters: [] });
        return Promise.resolve(take(`${table}:insert`));
      },
      eq(column: string, value: any) { filters.push([column, value]); return builder; },
      in(column: string, value: any) { filters.push([column, value]); return builder; },
      maybeSingle() {
        operations.push({ table, operation, payload, filters: [...filters] });
        return Promise.resolve(take(`${table}:${operation}`));
      },
      then(resolve: any, reject: any) {
        operations.push({ table, operation, payload, filters: [...filters] });
        return Promise.resolve(take(`${table}:${operation}`)).then(resolve, reject);
      },
    };
    return builder;
  };
  return { client: { from }, operations };
}

const input = {
  dutyId: "duty-1", eventId: "event-1", completedAt: "2026-08-12T10:00:00Z",
  actorId: "actor-1", memberName: "Alex", dutyName: "Canteen",
  eventTitle: "Match", teamId: "team-1", clubId: "club-1",
};

describe("event duty completion workflow", () => {
  it("conditionally completes an open duty and notifies each other team manager once", async () => {
    const { client, operations } = clientWith({
      "duties:update": [{ data: { id: "duty-1" }, error: null }],
      "user_roles:select": [{ data: [
        { user_id: "actor-1" }, { user_id: "admin-1" }, { user_id: "admin-1" }, { user_id: null },
      ], error: null }],
      "notifications:insert": [{ data: null, error: null }],
    });
    await expect(completeEventDuty(client, input)).resolves.toEqual({ outcome: "completed" });
    expect(operations[0]).toMatchObject({
      table: "duties", operation: "update",
      payload: { status: "completed", completed_at: input.completedAt },
      filters: [["id", "duty-1"], ["status", "open"]],
    });
    expect(operations.find((op) => op.operation === "insert")?.payload).toEqual([{
      user_id: "admin-1", type: "duty_completed",
      message: "Alex completed Canteen for Match", related_id: "event-1",
    }]);
  });

  it("returns noop and sends no notification when the duty is no longer open", async () => {
    const { client, operations } = clientWith({
      "duties:update": [{ data: null, error: null }],
    });
    await expect(completeEventDuty(client, input)).resolves.toEqual({ outcome: "noop" });
    expect(operations.filter((op) => op.table !== "duties")).toEqual([]);
  });

  it("propagates a duty update failure as a complete failure", async () => {
    const denied = { message: "duty denied" };
    const { client, operations } = clientWith({
      "duties:update": [{ data: null, error: denied }],
    });
    await expect(completeEventDuty(client, input)).rejects.toBe(denied);
    expect(operations.filter((op) => op.table !== "duties")).toEqual([]);
  });

  it("reports manager lookup failure as partial after duty commit", async () => {
    const { client } = clientWith({
      "duties:update": [{ data: { id: "duty-1" }, error: null }],
      "user_roles:select": [{ data: null, error: { message: "roles denied" } }],
    });
    await expect(completeEventDuty(client, input)).rejects.toMatchObject({
      name: "DutyNotificationPartialError", dutyCommitted: true, underlying: "roles denied",
    });
  });

  it("reports notification failure as partial but tolerates duplicate delivery conflict", async () => {
    const setup = (error: any) => clientWith({
      "duties:update": [{ data: { id: "duty-1" }, error: null }],
      "user_roles:select": [{ data: [{ user_id: "admin-1" }], error: null }],
      "notifications:insert": [{ data: null, error }],
    }).client;
    await expect(completeEventDuty(setup({ message: "notify denied", code: "42501" }), input))
      .rejects.toBeInstanceOf(DutyNotificationPartialError);
    await expect(completeEventDuty(setup({ message: "duplicate", code: "23505" }), input))
      .resolves.toEqual({ outcome: "completed" });
  });

  it("uses the narrower club-manager audience for club-wide events", async () => {
    const { client, operations } = clientWith({
      "duties:update": [{ data: { id: "duty-1" }, error: null }],
      "user_roles:select": [{ data: [], error: null }],
    });
    await completeEventDuty(client, { ...input, teamId: null });
    expect(operations[1].filters).toEqual([
      ["club_id", "club-1"], ["role", ["club_admin", "committee_member"]],
    ]);
  });
});
