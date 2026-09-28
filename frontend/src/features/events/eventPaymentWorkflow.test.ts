import { describe, expect, it } from "vitest";
import { setEventPaymentStatus } from "./eventPaymentWorkflow";

function clientWith(result: { data: any; error: any }) {
  const operations: any[] = [];
  const from = (table: string) => {
    let operation = "";
    let payload: any;
    const filters: any[] = [];
    const builder: any = {
      delete() { operation = "delete"; return builder; },
      insert(value: any) {
        operations.push({ table, operation: "insert", payload: value, filters: [] });
        return Promise.resolve(result);
      },
      eq(column: string, value: any) {
        filters.push([column, value]);
        if (filters.length === 2) {
          operations.push({ table, operation, payload, filters: [...filters] });
          return Promise.resolve(result);
        }
        return builder;
      },
    };
    return builder;
  };
  return { client: { from }, operations };
}

describe("event payment workflow", () => {
  it("records the exact event/member paid ledger row", async () => {
    const { client, operations } = clientWith({ data: null, error: null });
    await setEventPaymentStatus(client, {
      eventId: "event-1", userId: "user-2", isPaid: false,
      amount: 14.75, paidAt: "2026-08-12T12:00:00Z",
    });
    expect(operations).toEqual([{
      table: "event_payments", operation: "insert", filters: [],
      payload: {
        event_id: "event-1", user_id: "user-2", amount: 14.75,
        payment_status: "paid", paid_at: "2026-08-12T12:00:00Z",
      },
    }]);
  });

  it("removes only the selected member's payment for the selected event", async () => {
    const { client, operations } = clientWith({ data: null, error: null });
    await setEventPaymentStatus(client, {
      eventId: "event-1", userId: "user-2", isPaid: true,
      amount: 14.75, paidAt: "unused",
    });
    expect(operations).toEqual([{
      table: "event_payments", operation: "delete", payload: undefined,
      filters: [["event_id", "event-1"], ["user_id", "user-2"]],
    }]);
  });

  it.each([false, true])("propagates denied ledger writes when current paid state is %s", async (isPaid) => {
    const denied = { message: "payment denied", code: "42501" };
    const { client } = clientWith({ data: null, error: denied });
    await expect(setEventPaymentStatus(client, {
      eventId: "event-1", userId: "user-2", isPaid,
      amount: 14.75, paidAt: "2026-08-12T12:00:00Z",
    })).rejects.toBe(denied);
  });
});
