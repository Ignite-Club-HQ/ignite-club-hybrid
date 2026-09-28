import { describe, expect, it, vi } from "vitest";
import {
  cancelEventRows,
  SeriesCancellationPartialError,
} from "@/features/events/eventCancellationWorkflow";

function clientWith(errors: unknown[]) {
  const operations: Array<{ payload: unknown; filter: unknown[] }> = [];
  const from = vi.fn(() => {
    const operation = { payload: null as unknown, filter: [] as unknown[] };
    const builder: any = {
      update: (payload: unknown) => { operation.payload = payload; operations.push(operation); return builder; },
      eq: (column: string, value: unknown) => {
        operation.filter = [column, value];
        return Promise.resolve({ error: errors.shift() ?? null });
      },
    };
    return builder;
  });
  return { client: { from }, operations };
}

describe("event cancellation write workflow", () => {
  it("cancels exactly one event for a single action", async () => {
    const { client, operations } = clientWith([null]);
    await cancelEventRows(client, {
      eventId: "event-1", cancelType: "single", isRecurring: true, parentEventId: "parent-1",
    });
    expect(operations).toEqual([{
      payload: { is_cancelled: true, chat_cancel_post_handled: true },
      filter: ["id", "event-1"],
    }]);
  });

  it("cancels children then parent using a child event's root id", async () => {
    const { client, operations } = clientWith([null, null]);
    await cancelEventRows(client, {
      eventId: "child-1", cancelType: "series", isRecurring: true, parentEventId: "parent-1",
    });
    expect(operations.map((operation) => operation.filter)).toEqual([
      ["parent_event_id", "parent-1"], ["id", "parent-1"],
    ]);
  });

  it("uses the current id when cancelling from the recurring parent", async () => {
    const { client, operations } = clientWith([null, null]);
    await cancelEventRows(client, {
      eventId: "parent-1", cancelType: "series", isRecurring: true,
    });
    expect(operations[0].filter).toEqual(["parent_event_id", "parent-1"]);
  });

  it("falls back to one-event cancellation when series is requested for a non-series event", async () => {
    const { client, operations } = clientWith([null]);
    await cancelEventRows(client, {
      eventId: "event-1", cancelType: "series", isRecurring: false, parentEventId: null,
    });
    expect(operations).toHaveLength(1);
    expect(operations[0].filter).toEqual(["id", "event-1"]);
  });

  it("propagates complete single and series failures", async () => {
    const denied = { code: "42501", message: "denied" };
    await expect(cancelEventRows(clientWith([denied]).client, {
      eventId: "event-1", cancelType: "single", isRecurring: false,
    })).rejects.toBe(denied);
    await expect(cancelEventRows(clientWith([denied, denied]).client, {
      eventId: "event-1", cancelType: "series", isRecurring: true,
    })).rejects.toBe(denied);
  });

  it.each([
    [null, { message: "parent denied" }, true, false],
    [{ message: "children denied" }, null, false, true],
  ])("reports exact partial commit state", async (childError, parentError, childrenCommitted, parentCommitted) => {
    const error = await cancelEventRows(clientWith([childError, parentError]).client, {
      eventId: "parent-1", cancelType: "series", isRecurring: true,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(SeriesCancellationPartialError);
    expect(error).toMatchObject({ childrenCommitted, parentCommitted });
  });
});
