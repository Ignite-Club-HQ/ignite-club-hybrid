import { expect, test, vi } from "vitest";
import { fetchEventDetail } from "../src/features/events/eventDetailRepository";
import { completeEventDuty } from "../src/features/events/eventDutyCompletionWorkflow";
import { cancelEventRows, SeriesCancellationPartialError } from "../src/features/events/eventCancellationWorkflow";
import { setEventPaymentStatus } from "../src/features/events/eventPaymentWorkflow";
import {
  saveGuardianChildRsvp,
  savePersonalRsvp,
} from "../src/features/events/eventRsvpWorkflow";
import { resolveEventRecipients } from "../src/features/events/eventRecipientPolicy";
import {
  mergeTargetedChildren,
  selectTargetedReminderMembers,
} from "../src/features/events/targetedAttendanceRepository";

type Result = { data: any; error: any };
type Operation = {
  table: string;
  kind: "insert" | "update" | "delete" | "select";
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

function localClient(results: Record<string, Result | Result[]> = {}) {
  const operations: Operation[] = [];
  const calls = new Map<string, number>();
  const take = (table: string): Result => {
    const configured = results[table] ?? { data: null, error: null };
    const sequence = Array.isArray(configured) ? configured : [configured];
    const index = calls.get(table) ?? 0;
    calls.set(table, index + 1);
    return sequence[Math.min(index, sequence.length - 1)];
  };

  const from = vi.fn((table: string) => {
    let operation: Operation = { table, kind: "select", filters: [] };
    const query: any = {};
    query.select = vi.fn(() => query);
    query.insert = vi.fn((payload: unknown) => {
      operation = { table, kind: "insert", payload, filters: [] };
      operations.push(operation);
      return query;
    });
    query.update = vi.fn((payload: unknown) => {
      operation = { table, kind: "update", payload, filters: [] };
      operations.push(operation);
      return query;
    });
    query.delete = vi.fn(() => {
      operation = { table, kind: "delete", filters: [] };
      operations.push(operation);
      return query;
    });
    for (const method of ["eq", "in", "is", "not", "limit", "order"]) {
      query[method] = vi.fn((...args: [string, unknown]) => {
        operation.filters.push([args[0], args[1]]);
        return query;
      });
    }
    query.single = vi.fn(async () => take(table));
    query.maybeSingle = vi.fn(async () => take(table));
    query.then = (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(take(table)).then(resolve, reject);
    return query;
  });

  return {
    client: {
      from,
      rpc: vi.fn(async (name: string, args: unknown) => take(`${name}:${JSON.stringify(args)}`)),
    },
    from,
    operations,
  };
}

test("EventDetailPage export: writes a personal RSVP once with explicit ownership and source", async () => {
  const { client, operations } = localClient({
    rsvps: { data: { id: "rsvp-1" }, error: null },
  });
  await expect(savePersonalRsvp(client, {
    eventId: "event-1",
    userId: "user-1",
    status: "going",
    notes: null,
    existingRsvpId: null,
    online: true,
  }, vi.fn())).resolves.toEqual({ queued: false, rsvpId: "rsvp-1" });
  expect(operations).toEqual([{
    table: "rsvps",
    kind: "insert",
    payload: {
      event_id: "event-1",
      user_id: "user-1",
      status: "going",
      notes: null,
      source: "user",
    },
    filters: [],
  }]);
});

test("EventDetailPage export: updates an existing RSVP and queues offline work without writing", async () => {
  const { client, operations } = localClient();
  const enqueue = vi.fn();
  await expect(savePersonalRsvp(client, {
    eventId: "event-1",
    userId: "user-1",
    status: "maybe",
    notes: null,
    existingRsvpId: "rsvp-existing",
    online: true,
  }, enqueue)).resolves.toEqual({ queued: false, rsvpId: "rsvp-existing" });
  await expect(savePersonalRsvp(client, {
    eventId: "event-1",
    userId: "user-1",
    status: "going",
    notes: "offline",
    existingRsvpId: null,
    online: false,
  }, enqueue)).resolves.toEqual({ queued: true, rsvpId: null });
  expect(operations[0]).toMatchObject({
    kind: "update",
    payload: { status: "maybe", notes: null, source: "user" },
    filters: [["id", "rsvp-existing"]],
  });
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
    eventId: "event-1",
    userId: "user-1",
    status: "going",
  }));
});

test("EventDetailPage export: propagates denied RSVP writes and resolves canonical child rows", async () => {
  const failure = { message: "RLS rejected RSVP", code: "42501" };
  const denied = localClient({ rsvps: { data: null, error: failure } });
  await expect(savePersonalRsvp(denied.client, {
    eventId: "event-1",
    userId: "user-1",
    status: "going",
    notes: null,
    existingRsvpId: null,
    online: true,
  }, vi.fn())).rejects.toEqual(failure);

  const canonical = localClient({
    rsvps: [
      { data: null, error: null },
      { data: { id: "canonical-rsvp" }, error: null },
    ],
  });
  await expect(saveGuardianChildRsvp(canonical.client, {
    eventId: "event-1",
    guardianUserId: "parent-1",
    childId: "child-1",
    status: "going",
    existingRsvpId: null,
  })).resolves.toEqual({ queued: false, rsvpId: "canonical-rsvp" });
  expect(canonical.operations[0]).toMatchObject({
    table: "rsvps",
    kind: "insert",
    payload: {
      user_id: "parent-1",
      child_id: "child-1",
      source: "user",
    },
  });
});

test("EventDetailPage export: normalizes payment writes and does not hide failures", async () => {
  const paid = localClient();
  await expect(setEventPaymentStatus(paid.client, {
    eventId: "event-1",
    userId: "member-2",
    isPaid: false,
    amount: 24.5,
    paidAt: "2099-08-10T10:00:00.000Z",
  })).resolves.toBeUndefined();
  expect(paid.operations[0]).toMatchObject({
    table: "event_payments",
    kind: "insert",
    payload: {
      event_id: "event-1",
      user_id: "member-2",
      amount: 24.5,
      payment_status: "paid",
    },
  });

  const denied = { message: "payment update denied", code: "42501" };
  const failed = localClient({ event_payments: { data: null, error: denied } });
  await expect(setEventPaymentStatus(failed.client, {
    eventId: "event-1",
    userId: "member-2",
    isPaid: false,
    amount: 24.5,
    paidAt: "2099-08-10T10:00:00.000Z",
  })).rejects.toEqual(denied);
});

test("EventDetailPage export: cancels a series in order and reports a partial commit", async () => {
  const successful = localClient({
    events: [
      { data: [{ id: "child-1" }], error: null },
      { data: [{ id: "event-1" }], error: null },
    ],
  });
  await expect(cancelEventRows(successful.client, {
    eventId: "event-1",
    cancelType: "series",
    isRecurring: true,
  })).resolves.toBeUndefined();
  expect(successful.operations).toEqual([
    { table: "events", kind: "update", payload: { is_cancelled: true, chat_cancel_post_handled: true }, filters: [["parent_event_id", "event-1"]] },
    { table: "events", kind: "update", payload: { is_cancelled: true, chat_cancel_post_handled: true }, filters: [["id", "event-1"]] },
  ]);

  const partial = localClient({
    events: [
      { data: [{ id: "child-1" }], error: null },
      { data: null, error: { message: "parent cancellation denied" } },
    ],
  });
  await expect(cancelEventRows(partial.client, {
    eventId: "event-1",
    cancelType: "series",
    isRecurring: true,
  })).rejects.toBeInstanceOf(SeriesCancellationPartialError);
});

test("EventDetailPage export: reports committed duty work separately from notification failure", async () => {
  const client = localClient({
    duties: { data: { id: "duty-1" }, error: null },
    user_roles: { data: [{ user_id: "admin-2" }, { user_id: "admin-2" }], error: null },
    notifications: { data: null, error: { message: "notification denied", code: "42501" } },
  });
  await expect(completeEventDuty(client.client, {
    dutyId: "duty-1",
    eventId: "event-1",
    completedAt: "2099-08-10T10:00:00.000Z",
    actorId: "user-1",
    memberName: "Test Person",
    dutyName: "Canteen",
    eventTitle: "Synthetic match",
    clubId: "club-1",
  })).rejects.toMatchObject({
    name: "DutyNotificationPartialError",
    underlying: "notification denied",
  });
  expect(client.operations[0]).toMatchObject({
    table: "duties",
    kind: "update",
    payload: { status: "completed" },
    filters: [["id", "duty-1"], ["status", "open"]],
  });
  expect(client.operations[1]).toMatchObject({
    table: "notifications",
    kind: "insert",
    payload: [{
      user_id: "admin-2",
      type: "duty_completed",
      related_id: "event-1",
    }],
  });
});

test("EventDetailPage export: restricts reminders to targeted teams and deduplicates recipients", async () => {
  const rpc = vi.fn(async () => ({
    data: [{ user_id: "target-player" }, { user_id: "target-player" }],
    error: null,
  }));
  await expect(resolveEventRecipients({ rpc }, {
    eventId: "event-1",
    clubId: "club-1",
    targetTeamIds: ["team-2", "team-3"],
  })).resolves.toEqual(["target-player"]);

  expect(selectTargetedReminderMembers([
    { id: "target-player", role_team_pairs: [{ role: "player", team_id: "team-2" }] },
    { id: "uninvited-player", role_team_pairs: [{ role: "player", team_id: "team-9" }] },
  ], ["team-2", "team-3"], [], [])).toEqual([
    { id: "target-player", role_team_pairs: [{ role: "player", team_id: "team-2" }] },
  ]);
});

test("EventDetailPage export: deduplicates targeted children and distinguishes unavailable events", async () => {
  expect(mergeTargetedChildren([], [
    { kind: "child", person_id: "child-shared", display_name: "Shared Player", parent_id: "parent-1", team_ids: ["team-2"] },
    { kind: "child", person_id: "child-shared", display_name: "Shared Player", parent_id: "parent-1", team_ids: ["team-3"] },
    { kind: "child", person_id: "child-other", display_name: "Other Player", parent_id: "parent-2", team_ids: ["team-2"] },
  ])).toEqual([
    { id: "child-shared", name: "Shared Player", parent_id: "parent-1" },
    { id: "child-other", name: "Other Player", parent_id: "parent-2" },
  ]);

  const missing = localClient({ events: { data: null, error: null } });
  await expect(fetchEventDetail(missing.client, "event-1")).resolves.toBeNull();
  const failure = new Error("network request failed");
  const unavailable = localClient({ events: { data: null, error: failure } });
  await expect(fetchEventDetail(unavailable.client, "event-1")).rejects.toBe(failure);
});
