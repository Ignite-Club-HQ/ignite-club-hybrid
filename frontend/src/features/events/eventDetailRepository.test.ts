import { describe, expect, it, vi } from "vitest";
import {
  EVENT_DETAIL_SELECT,
  fetchEventDetail,
} from "@/features/events/eventDetailRepository";

function clientResult(result: { data: any; error: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, eq, maybeSingle };
}

describe("event detail repository", () => {
  it("reads exactly one event with its team and club display context", async () => {
    const row = { id: "event-1", title: "Synthetic match" };
    const db = clientResult({ data: row, error: null });

    await expect(fetchEventDetail(db.client, "event-1")).resolves.toBe(row);
    expect(db.from).toHaveBeenCalledWith("events");
    expect(db.select).toHaveBeenCalledWith(EVENT_DETAIL_SELECT);
    expect(db.eq).toHaveBeenCalledWith("id", "event-1");
    expect(db.maybeSingle).toHaveBeenCalledOnce();
  });

  it("returns null only for a successful missing or RLS-hidden row", async () => {
    const db = clientResult({ data: null, error: null });
    await expect(fetchEventDetail(db.client, "missing-event")).resolves.toBeNull();
  });

  it("propagates permission failures instead of presenting a missing event", async () => {
    const denied = { code: "42501", message: "permission denied" };
    const db = clientResult({ data: null, error: denied });
    await expect(fetchEventDetail(db.client, "event-1")).rejects.toBe(denied);
  });

  it("propagates transient failures so React Query can retry them", async () => {
    const unavailable = { status: 503, message: "temporarily unavailable" };
    const db = clientResult({ data: null, error: unavailable });
    await expect(fetchEventDetail(db.client, "event-1")).rejects.toBe(unavailable);
  });
});
