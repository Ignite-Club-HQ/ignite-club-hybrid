import { describe, expect, it } from "vitest";
import { sendBulkEventReminders, sendIndividualEventReminder } from "./eventReminderWorkflow";

type Result = { data: any; error: any };

function clientWith(results: Record<string, Result[]>) {
  const inserts: Array<{ table: string; payload: any }> = [];
  const take = (key: string): Result => results[key]?.shift() ?? { data: [], error: null };
  const from = (table: string) => {
    let operation = "select";
    const builder: any = {
      select() { operation = "select"; return builder; },
      insert(payload: any) { operation = "insert"; inserts.push({ table, payload }); return Promise.resolve(take(`${table}:insert`)); },
      eq() { return builder; },
      in() { return builder; },
      gte() { return builder; },
      maybeSingle() { return Promise.resolve(take(`${table}:${operation}`)); },
      then(resolve: any, reject: any) { return Promise.resolve(take(`${table}:${operation}`)).then(resolve, reject); },
    };
    return builder;
  };
  return { client: { from }, inserts };
}

describe("event reminder workflow", () => {
  it("bulk-reminds unique eligible non-responders outside cooldown", async () => {
    const { client, inserts } = clientWith({
      "rsvps:select": [{ data: [{ user_id: "responded" }], error: null }],
      "user_roles:select": [{ data: [
        { user_id: "responded", role: "player" },
        { user_id: "new-1", role: "parent" },
        { user_id: "new-1", role: "coach" },
        { user_id: "cooldown", role: "player" },
      ], error: null }],
      "notifications:select": [{ data: [{ user_id: "cooldown" }], error: null }],
      "notifications:insert": [{ data: null, error: null }],
    });
    await expect(sendBulkEventReminders(client, {
      eventId: "event-1", title: "Match", cooldownSince: "2026-08-11T00:00:00Z",
      recipientContext: { eventId: "event-1", teamId: "team-1" },
    })).resolves.toBe(1);
    expect(inserts[0].payload).toEqual([{
      user_id: "new-1", type: "event_reminder",
      message: 'Reminder: Please RSVP for "Match"', related_id: "event-1",
    }]);
  });

  it("fails before audience resolution or insertion when RSVP state cannot be read", async () => {
    const denied = { message: "rsvp denied" };
    const { client, inserts } = clientWith({ "rsvps:select": [{ data: null, error: denied }] });
    await expect(sendBulkEventReminders(client, {
      eventId: "event-1", title: "Match", cooldownSince: "now",
      recipientContext: { eventId: "event-1", teamId: "team-1" },
    })).rejects.toBe(denied);
    expect(inserts).toEqual([]);
  });

  it("fails closed when the bulk cooldown read fails", async () => {
    const denied = { message: "cooldown denied" };
    const { client, inserts } = clientWith({
      "rsvps:select": [{ data: [], error: null }],
      "user_roles:select": [{ data: [{ user_id: "member-1", role: "player" }], error: null }],
      "notifications:select": [{ data: null, error: denied }],
    });
    await expect(sendBulkEventReminders(client, {
      eventId: "event-1", title: "Match", cooldownSince: "now",
      recipientContext: { eventId: "event-1", teamId: "team-1" },
    })).rejects.toBe(denied);
    expect(inserts).toEqual([]);
  });

  it("deduplicates an individual child's parents and excludes cooldown recipients", async () => {
    const { client, inserts } = clientWith({
      "child_guardians:select": [{ data: [{ guardian_id: "parent-1" }, { guardian_id: "guardian-2" }], error: null }],
      "children:select": [{ data: { parent_id: "parent-1" }, error: null }],
      "notifications:select": [{ data: [{ user_id: "guardian-2" }], error: null }],
      "notifications:insert": [{ data: null, error: null }],
    });
    await expect(sendIndividualEventReminder(client, {
      eventId: "event-1", title: "Match", displayName: "Child One",
      cooldownSince: "now", userId: "parent-1", childId: "child-1",
    })).resolves.toEqual({ displayName: "Child One", count: 1, isChild: true, recipientKey: "parent-1" });
    expect(inserts[0].payload.map((row: any) => row.user_id)).toEqual(["parent-1"]);
  });

  it("creates no notification when either authoritative child lookup fails", async () => {
    const { client, inserts } = clientWith({
      "child_guardians:select": [{ data: null, error: { message: "guardian read failed" } }],
      "children:select": [{ data: { parent_id: "parent-1" }, error: null }],
    });
    await expect(sendIndividualEventReminder(client, {
      eventId: "event-1", title: "Match", displayName: "Child One",
      cooldownSince: "now", childId: "child-1",
    })).rejects.toThrow("Couldn't check who to remind");
    expect(inserts).toEqual([]);
  });

  it("propagates notification insertion failure", async () => {
    const denied = { message: "insert denied" };
    const { client } = clientWith({
      "notifications:select": [{ data: [], error: null }],
      "notifications:insert": [{ data: null, error: denied }],
    });
    await expect(sendIndividualEventReminder(client, {
      eventId: "event-1", title: "Match", displayName: "Adult",
      cooldownSince: "now", userId: "adult-1",
    })).rejects.toBe(denied);
  });
});
