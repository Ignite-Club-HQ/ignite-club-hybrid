import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchEventRsvps } from "@/features/events/eventRsvpRepository";

const backendMocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  snapshot: vi.fn(),
  scopes: [] as Array<{ feature: string; scope: unknown }>,
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }, scope?: unknown) => {
    backendMocks.scopes.push({ feature, scope });
    return backendMocks.mode === "icp" ? providers.icp(backendMocks.context) : providers.supabase();
  },
}));
vi.mock("@/live/features/events", () => ({
  getLiveEventsSnapshot: (...args: unknown[]) => backendMocks.snapshot(...args),
}));

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
  beforeEach(() => {
    backendMocks.snapshot.mockReset();
    backendMocks.scopes.length = 0;
  });

  it.runIf(backendMocks.mode === "supabase")("isolates the authoritative RSVP read to the requested event", async () => {
    const db = clientWith({ rsvps: [] });
    await expect(fetchEventRsvps(db.client, "event-1", vi.fn())).resolves.toEqual([]);
    expect(db.calls).toContainEqual({ table: "rsvps", filter: ["event_id", "event-1"] });
  });

  it.runIf(backendMocks.mode === "supabase")("enriches adult and child rows without changing RSVP ownership", async () => {
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

  it.runIf(backendMocks.mode === "supabase")("propagates the core RSVP read error and performs no enrichment", async () => {
    const denied = { code: "42501", message: "denied" };
    const db = clientWith({ rsvpError: denied });
    const loadProfiles = vi.fn();
    await expect(fetchEventRsvps(db.client, "event-1", loadProfiles)).rejects.toBe(denied);
    expect(loadProfiles).not.toHaveBeenCalled();
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it.runIf(backendMocks.mode === "supabase")("keeps valid attendance rows when display-only enrichment is unavailable", async () => {
    const db = clientWith({
      rsvps: [{ id: "r1", user_id: "adult-1", child_id: "child-1", status: "going" }],
      childError: { status: 503 },
    });
    const loadProfiles = vi.fn().mockResolvedValue({ data: null, error: { status: 503 } });
    await expect(fetchEventRsvps(db.client, "event-1", loadProfiles)).resolves.toEqual([
      expect.objectContaining({ id: "r1", profiles: null, children: null }),
    ]);
  });

  it.runIf(backendMocks.mode === "icp")("maps caller RSVP snapshot rows and enriches profiles without Supabase reads", async () => {
    backendMocks.snapshot.mockResolvedValue({ rsvps: [
      { event_id: "event-icp", account_id: "principal-a", child_id: [], state: "going", updated_at_ms: 1_800_000_000_000n },
      { event_id: "other-event", account_id: "principal-b", child_id: [], state: "maybe", updated_at_ms: 1n },
    ] });
    const client = { from: vi.fn() };
    const loadProfiles = vi.fn().mockResolvedValue({ data: [{ id: "principal-a", display_name: "Adult", avatar_url: null }] });

    await expect(fetchEventRsvps(client, "event-icp", loadProfiles)).resolves.toEqual([
      expect.objectContaining({
        event_id: "event-icp",
        user_id: "principal-a",
        status: "going",
        profiles: { display_name: "Adult", avatar_url: null },
        children: null,
      }),
    ]);
    expect(backendMocks.snapshot).toHaveBeenCalledWith(backendMocks.context);
    expect(loadProfiles).toHaveBeenCalledWith(["principal-a"]);
    expect(backendMocks.scopes).toEqual([{ feature: "events", scope: { eventId: "event-icp" } }]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it.runIf(backendMocks.mode === "icp")("propagates snapshot failure before profile enrichment", async () => {
    const denied = new Error("RSVP snapshot unavailable");
    backendMocks.snapshot.mockRejectedValueOnce(denied);
    const client = { from: vi.fn() };
    const loadProfiles = vi.fn();

    await expect(fetchEventRsvps(client, "event-icp", loadProfiles)).rejects.toBe(denied);
    expect(loadProfiles).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });
});
