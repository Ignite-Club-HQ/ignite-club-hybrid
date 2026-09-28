import { describe, expect, it } from "vitest";
import { persistResentEventInvites } from "./eventInviteResendWorkflow";

type Result = { data: any; error: any };

function clientWith(results: Record<string, Result[]>) {
  const operations: Array<{ table: string; operation: string; payload?: any; filters: any[] }> = [];
  const take = (key: string): Result => results[key]?.shift() ?? { data: [], error: null };
  const from = (table: string) => {
    let operation = "select";
    const filters: any[] = [];
    const builder: any = {
      select() { operation = "select"; return builder; },
      insert(payload: any) {
        operation = "insert";
        operations.push({ table, operation, payload, filters: [...filters] });
        return Promise.resolve(take(`${table}:insert`));
      },
      eq(column: string, value: any) { filters.push(["eq", column, value]); return builder; },
      in(column: string, value: any) { filters.push(["in", column, value]); return builder; },
      then(resolve: any, reject: any) {
        operations.push({ table, operation, filters: [...filters] });
        return Promise.resolve(take(`${table}:${operation}`)).then(resolve, reject);
      },
    };
    return builder;
  };
  return { client: { from }, operations };
}

const input = {
  eventId: "event-1",
  title: "Synthetic match",
  creatorId: "creator-1",
  recipientContext: { eventId: "event-1", teamId: "team-1" },
};

describe("event invite resend workflow", () => {
  it("excludes the creator, deduplicates roles and inserts only never-notified members", async () => {
    const { client, operations } = clientWith({
      "user_roles:select": [{ data: [
        { user_id: "creator-1", role: "team_admin" },
        { user_id: "new-1", role: "player" },
        { user_id: "new-1", role: "coach" },
        { user_id: "old-1", role: "parent" },
      ], error: null }],
      "notifications:select": [{ data: [{ user_id: "old-1" }], error: null }],
      "notifications:insert": [{ data: null, error: null }],
    });
    await expect(persistResentEventInvites(client, input)).resolves.toEqual(["new-1"]);
    expect(operations.find((op) => op.operation === "insert")?.payload).toEqual([{
      user_id: "new-1",
      type: "event_invite",
      message: "You've been invited to: Synthetic match",
      related_id: "event-1",
      skip_push: true,
    }]);
  });

  it("propagates recipient-resolution failure before notification reads or writes", async () => {
    const denied = { message: "roles denied" };
    const { client, operations } = clientWith({
      "user_roles:select": [{ data: null, error: denied }],
    });
    await expect(persistResentEventInvites(client, input)).rejects.toBe(denied);
    expect(operations.filter((op) => op.table === "notifications")).toEqual([]);
  });

  it("propagates existing-invite lookup failure without inserting", async () => {
    const denied = { message: "history denied" };
    const { client, operations } = clientWith({
      "user_roles:select": [{ data: [{ user_id: "new-1", role: "player" }], error: null }],
      "notifications:select": [{ data: null, error: denied }],
    });
    await expect(persistResentEventInvites(client, input)).rejects.toBe(denied);
    expect(operations.some((op) => op.operation === "insert")).toBe(false);
  });

  it("does not insert when every eligible member was already notified", async () => {
    const { client, operations } = clientWith({
      "user_roles:select": [{ data: [{ user_id: "old-1", role: "player" }], error: null }],
      "notifications:select": [{ data: [{ user_id: "old-1" }], error: null }],
    });
    await expect(persistResentEventInvites(client, input)).rejects.toThrow(
      "All members have already been notified",
    );
    expect(operations.some((op) => op.operation === "insert")).toBe(false);
  });

  it("propagates notification insertion failure", async () => {
    const denied = { message: "insert denied" };
    const { client } = clientWith({
      "user_roles:select": [{ data: [{ user_id: "new-1", role: "player" }], error: null }],
      "notifications:select": [{ data: [], error: null }],
      "notifications:insert": [{ data: null, error: denied }],
    });
    await expect(persistResentEventInvites(client, input)).rejects.toBe(denied);
  });
});
