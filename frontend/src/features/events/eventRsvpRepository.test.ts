import { describe, expect, it, vi } from "vitest";
import { fetchEventRsvps } from "@/features/events/eventRsvpRepository";

function clientWith(options: {
  rsvps?: any[] | null;
  rsvpError?: any;
  children?: any[] | null;
  childError?: any;
}) {
  const calls: Array<{ table: string; filter: [string, any] | null }> = [];
  const from = vi.fn((table: string) => {
    let filter: [string, any] | null = null;
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: any) => {
        filter = [column, value];
        calls.push({ table, filter });
        return query;
      }),
      in: vi.fn((column: string, value: any) => {
        filter = [column, value];
        calls.push({ table, filter });
        return query;
      }),
      then: (resolve: any) => Promise.resolve(
        table === "rsvps"
          ? { data: options.rsvps ?? null, error: options.rsvpError ?? null }
          : { data: options.children ?? null, error: options.childError ?? null },
      ).then(resolve),
    };
    return query;
  });
  return { client: { from }, from, calls };
}

describe("event RSVP repository", () => {
  it("isolates the authoritative RSVP read to the requested event", async () => {
    const db = clientWith({ rsvps: [] });
    await expect(fetchEventRsvps(db.client, "event-1", vi.fn())).resolves.toEqual([]);
    expect(db.calls).toContainEqual({ table: "rsvps", filter: ["event_id", "event-1"] });
  });

  it("enriches adult and child rows without changing RSVP ownership", async () => {
    const db = clientWith({
      rsvps: [
        { id: "r1", user_id: "adult-1", child_id: null, status: "going" },
        { id: "r2", user_id: "guardian-1", child_id: "child-1", status: "maybe" },
      ],
      children: [{ id: "child-1", name: "Child One" }],
    });
    const loadProfiles = vi.fn().mockResolvedValue({
      data: [
        { id: "adult-1", display_name: "Adult One", avatar_url: "adult.png" },
        { id: "guardian-1", display_name: "Guardian", avatar_url: null },
      ],
      error: null,
    });

    const rows = await fetchEventRsvps(db.client, "event-1", loadProfiles);
    expect(loadProfiles).toHaveBeenCalledWith(["adult-1", "guardian-1"]);
    expect(db.calls).toContainEqual({ table: "children", filter: ["id", ["child-1"]] });
    expect(rows).toEqual([
      expect.objectContaining({
        id: "r1", user_id: "adult-1", child_id: null,
        profiles: { display_name: "Adult One", avatar_url: "adult.png" }, children: null,
      }),
      expect.objectContaining({
        id: "r2", user_id: "guardian-1", child_id: "child-1",
        profiles: { display_name: "Guardian", avatar_url: null },
        children: { id: "child-1", name: "Child One" },
      }),
    ]);
  });

  it("propagates the core RSVP read error and performs no enrichment", async () => {
    const denied = { code: "42501", message: "denied" };
    const db = clientWith({ rsvpError: denied });
    const loadProfiles = vi.fn();
    await expect(fetchEventRsvps(db.client, "event-1", loadProfiles)).rejects.toBe(denied);
    expect(loadProfiles).not.toHaveBeenCalled();
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("keeps valid attendance rows when display-only enrichment is unavailable", async () => {
    const db = clientWith({
      rsvps: [{ id: "r1", user_id: "adult-1", child_id: "child-1", status: "going" }],
      childError: { status: 503 },
    });
    const loadProfiles = vi.fn().mockResolvedValue({ data: null, error: { status: 503 } });
    await expect(fetchEventRsvps(db.client, "event-1", loadProfiles)).resolves.toEqual([
      expect.objectContaining({ id: "r1", profiles: null, children: null }),
    ]);
  });
});
