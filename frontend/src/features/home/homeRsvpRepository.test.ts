import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchHomeUserRsvps } from "./homeRsvpRepository";

const backendMocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  snapshot: vi.fn(),
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    backendMocks.mode === "icp" ? providers.icp(backendMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/home", () => ({
  getLiveHomeSnapshot: (...args: unknown[]) => backendMocks.snapshot(...args),
}));

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
  beforeEach(() => backendMocks.snapshot.mockReset());

  it.runIf(backendMocks.mode === "supabase")("does not query when Home has no visible events", async () => {
    const { client } = createClient({ data: [], error: null });

    await expect(fetchHomeUserRsvps(client, "user-1", [])).resolves.toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it.runIf(backendMocks.mode === "supabase")("reads only the current adult user's RSVP for the visible event ids", async () => {
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

  it.runIf(backendMocks.mode === "supabase")("normalizes a successful null payload to an empty list", async () => {
    const { client } = createClient({ data: null, error: null });
    await expect(fetchHomeUserRsvps(client, "user-1", ["event-1"])).resolves.toEqual([]);
  });

  it.runIf(backendMocks.mode === "supabase")("propagates backend and permission failures", async () => {
    const failure = new Error("rsvps denied");
    const { client } = createClient({ data: null, error: failure });
    await expect(fetchHomeUserRsvps(client, "user-1", ["event-1"])).rejects.toBe(failure);
  });

  it.runIf(backendMocks.mode === "icp")("maps only the caller's visible RSVP snapshot rows", async () => {
    backendMocks.snapshot.mockResolvedValue({ rsvps: [
      { event_id: "event-1", account_id: "principal-a", state: "going" },
      { event_id: "event-2", account_id: "principal-a", state: "maybe" },
      { event_id: "event-1", account_id: "principal-b", state: "going" },
    ] });
    const client = { from: vi.fn() };
    await expect(fetchHomeUserRsvps(client, "principal-a", ["event-1"])).resolves.toEqual([
      { event_id: "event-1", status: "going" },
    ]);
    expect(backendMocks.snapshot).toHaveBeenCalledWith(backendMocks.context);
    expect(client.from).not.toHaveBeenCalled();
  });

  it.runIf(backendMocks.mode === "icp")("returns early for no visible events and propagates snapshot failures", async () => {
    const client = { from: vi.fn() };
    await expect(fetchHomeUserRsvps(client, "principal-a", [])).resolves.toEqual([]);
    expect(backendMocks.snapshot).not.toHaveBeenCalled();

    const denied = new Error("home snapshot unavailable");
    backendMocks.snapshot.mockRejectedValueOnce(denied);
    await expect(fetchHomeUserRsvps(client, "principal-a", ["event-1"])).rejects.toBe(denied);
    expect(client.from).not.toHaveBeenCalled();
  });
});
