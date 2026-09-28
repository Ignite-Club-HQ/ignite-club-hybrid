import { describe, expect, it, vi } from "vitest";
import { fetchHomeUserRsvps } from "./homeRsvpRepository";

function createClient(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.in.mockResolvedValue(result);

  return {
    client: { from: vi.fn().mockReturnValue(query) },
    query,
  };
}

describe("fetchHomeUserRsvps", () => {
  it("does not query when Home has no visible events", async () => {
    const { client } = createClient({ data: [], error: null });

    await expect(fetchHomeUserRsvps(client, "user-1", [])).resolves.toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("reads only the current adult user's RSVP for the visible event ids", async () => {
    const rows = [
      { event_id: "event-1", status: "going" },
      { event_id: "event-2", status: "maybe" },
    ];
    const { client, query } = createClient({ data: rows, error: null });

    await expect(
      fetchHomeUserRsvps(client, "user-1", ["event-1", "event-2"]),
    ).resolves.toEqual(rows);

    expect(client.from).toHaveBeenCalledWith("rsvps");
    expect(query.select).toHaveBeenCalledWith("event_id, status");
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(query.is).toHaveBeenCalledWith("child_id", null);
    expect(query.in).toHaveBeenCalledWith("event_id", ["event-1", "event-2"]);
  });

  it("normalizes a successful null payload to an empty list", async () => {
    const { client } = createClient({ data: null, error: null });
    await expect(fetchHomeUserRsvps(client, "user-1", ["event-1"])).resolves.toEqual([]);
  });

  it("propagates backend and permission failures", async () => {
    const failure = new Error("rsvps denied");
    const { client } = createClient({ data: null, error: failure });
    await expect(fetchHomeUserRsvps(client, "user-1", ["event-1"])).rejects.toBe(failure);
  });
});
