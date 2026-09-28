import { describe, expect, it, vi } from "vitest";
import {
  fetchEventDuties,
  fetchEventGuests,
} from "@/features/events/eventSupportingReadsRepository";

function clientWith(tables: Record<string, { data: any; error?: any }>) {
  const calls: Array<{ table: string; select: string; eventId: string }> = [];
  const from = vi.fn((table: string) => {
    let projection = "";
    const query: any = {
      select: vi.fn((value: string) => { projection = value; return query; }),
      eq: vi.fn((column: string, eventId: string) => {
        calls.push({ table, select: projection, eventId });
        expect(column).toBe("event_id");
        return query;
      }),
      then: (resolve: any) => Promise.resolve({
        data: tables[table]?.data ?? null,
        error: tables[table]?.error ?? null,
      }).then(resolve),
    };
    return query;
  });
  return { client: { from }, calls };
}

describe("event guest read repository", () => {
  it("isolates guests to one event and deduplicates profile enrichment", async () => {
    const db = clientWith({
      event_guests: { data: [
        { id: "g1", event_id: "event-1", added_by: "adult-1", name: "Guest One" },
        { id: "g2", event_id: "event-1", added_by: "adult-1", name: "Guest Two" },
      ] },
    });
    const profiles = vi.fn().mockResolvedValue({
      data: [{ id: "adult-1", display_name: "Adult One", avatar_url: null }],
      error: null,
    });

    const rows = await fetchEventGuests(db.client, "event-1", profiles);
    expect(db.calls).toContainEqual({ table: "event_guests", select: "*", eventId: "event-1" });
    expect(profiles).toHaveBeenCalledWith(["adult-1"]);
    expect(rows.map((row: any) => row.added_by_name)).toEqual(["Adult One", "Adult One"]);
  });

  it("uses a neutral fallback when display-only profile enrichment fails", async () => {
    const db = clientWith({
      event_guests: { data: [{ id: "g1", added_by: "adult-1" }] },
    });
    const profiles = vi.fn().mockResolvedValue({ data: null, error: { status: 503 } });
    await expect(fetchEventGuests(db.client, "event-1", profiles)).resolves.toEqual([
      expect.objectContaining({ id: "g1", added_by_name: "A member" }),
    ]);
  });

  it("propagates an authoritative guest read failure without loading profiles", async () => {
    const denied = { code: "42501", message: "denied" };
    const db = clientWith({ event_guests: { data: null, error: denied } });
    const profiles = vi.fn();
    await expect(fetchEventGuests(db.client, "event-1", profiles)).rejects.toBe(denied);
    expect(profiles).not.toHaveBeenCalled();
  });
});

describe("event duty read repository", () => {
  it("reads duties and assignee display context for exactly one event", async () => {
    const rows = [{ id: "d1", event_id: "event-1", assigned_to: "adult-1" }];
    const db = clientWith({ duties: { data: rows } });
    await expect(fetchEventDuties(db.client, "event-1")).resolves.toBe(rows);
    expect(db.calls).toContainEqual({
      table: "duties",
      select: "*, profiles:assigned_to (display_name, avatar_url)",
      eventId: "event-1",
    });
  });

  it("propagates duty read failures rather than returning an empty list", async () => {
    const unavailable = { status: 503, message: "unavailable" };
    const db = clientWith({ duties: { data: null, error: unavailable } });
    await expect(fetchEventDuties(db.client, "event-1")).rejects.toBe(unavailable);
  });
});
