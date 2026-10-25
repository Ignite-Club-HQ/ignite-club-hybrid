import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  EVENT_DETAIL_SELECT,
  fetchEventDetail,
} from "@/features/events/eventDetailRepository";

const backendMocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  events: vi.fn(),
  getTeam: vi.fn(),
  getClubName: vi.fn(),
  cachedTeam: null as any,
  cachedClub: null as any,
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    backendMocks.mode === "icp" ? providers.icp(backendMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({
  listLiveEvents: (...args: unknown[]) => backendMocks.events(...args),
  getListedLiveEvent: () => null,
}));
vi.mock("@/lib/icpClubTeamLookup", () => ({
  icpGetTeam: (...args: unknown[]) => backendMocks.getTeam(...args),
  icpGetClubName: (...args: unknown[]) => backendMocks.getClubName(...args),
}));
vi.mock("@/lib/clubTeamCache", () => ({
  getCachedTeam: () => backendMocks.cachedTeam,
  getCachedClub: () => backendMocks.cachedClub,
}));
vi.mock("@/live/features/club", () => ({
  getLiveTeam: async (...args: unknown[]) => {
    const team = await backendMocks.getTeam(...args);
    return team ? [team] : [];
  },
  getLiveClubProfile: async (...args: unknown[]) => {
    const name = await backendMocks.getClubName(...args);
    return name ? [{ name }] : [];
  },
}));

function clientResult(result: { data: any; error: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, eq, maybeSingle };
}

describe.runIf(backendMocks.mode === "supabase")("event detail repository", () => {
  it("passes only the event request's cancellation signal to its database read", async () => {
    const controller = new AbortController();
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'event-1' }, error: null });
    const abortSignal = vi.fn(() => ({ maybeSingle }));
    const client = { from: () => ({ select: () => ({ eq: () => ({ abortSignal }) }) }) };
    await fetchEventDetail(client, 'event-1', controller.signal);
    expect(abortSignal).toHaveBeenCalledWith(controller.signal);
  });
  beforeEach(() => {
    backendMocks.events.mockReset();
  });
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

describe.runIf(backendMocks.mode === "icp")("event detail repository ICP mapping", () => {
  it("opens a confirmed event even when both optional display lookups stall", async () => {
    backendMocks.getTeam.mockReturnValue(new Promise(() => {}));
    backendMocks.getClubName.mockReturnValue(new Promise(() => {}));
    backendMocks.events.mockResolvedValue([{
      id: "event-icp", club_id: "club-1", team_id: ["team-1"], title: "Final",
      event_type: "game", starts_at_ms: 1_800_000_000_000n, ends_at_ms: 0n,
    }]);
    vi.useFakeTimers();
    try {
      const pending = fetchEventDetail({ from: vi.fn() }, "event-icp");
      await vi.advanceTimersByTimeAsync(1501);
      const event = await pending;
      expect(event?.id).toBe("event-icp");
      expect(event?.teams).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  beforeEach(() => {
    backendMocks.events.mockReset();
    backendMocks.getTeam.mockReset().mockResolvedValue({ id: "team-1", name: "Tigers" });
    backendMocks.getClubName.mockReset().mockResolvedValue("North Club");
    backendMocks.cachedTeam = null;
    backendMocks.cachedClub = null;
  });

  it("does not wait for more name requests when the owning club/team metadata is already loaded", async () => {
    backendMocks.cachedTeam = { id: "team-1", club_id: "club-1", name: "Tigers" };
    backendMocks.cachedClub = { id: "club-1", name: "North Club" };
    backendMocks.events.mockResolvedValue([{
      id: "event-icp", club_id: "club-1", team_id: ["team-1"],
      title: "Final", event_type: "game", starts_at_ms: 1_800_000_000_000n,
      ends_at_ms: 0n, series_id: [],
    }]);
    const result = await fetchEventDetail({ from: vi.fn() }, "event-icp");
    expect(result?.teams?.name).toBe("Tigers");
    expect(backendMocks.getTeam).not.toHaveBeenCalled();
    expect(backendMocks.getClubName).not.toHaveBeenCalled();
  });

  it("maps a canister event into the shared detail row without Supabase reads", async () => {
    backendMocks.events.mockResolvedValue([{
      id: "event-icp",
      club_id: "club-1",
      team_id: ["team-1"],
      title: "Final",
      description: "Season final",
      event_type: "game",
      starts_at_ms: 1_800_000_000_000n,
      ends_at_ms: 1_800_003_600_000n,
      cancelled: false,
      series_id: [],
      address: [],
      location: ["Main Oval"],
      opponent: ["Tigers"],
      mini_league_id: [],
    }]);
    const client = { from: vi.fn() };

    await expect(fetchEventDetail(client, "event-icp")).resolves.toEqual(expect.objectContaining({
      id: "event-icp",
      type: "game",
      team_id: "team-1",
      event_date: new Date(1_800_000_000_000).toISOString(),
      teams: expect.objectContaining({ name: "Tigers" }),
      clubs: expect.objectContaining({ name: "North Club" }),
    }));
    expect(backendMocks.events).toHaveBeenCalledWith(backendMocks.context);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns null when the canister confirms the event is absent", async () => {
    backendMocks.events.mockResolvedValue([]);
    const client = { from: vi.fn() };

    await expect(fetchEventDetail(client, "missing-event")).resolves.toBeNull();
    expect(backendMocks.getTeam).not.toHaveBeenCalled();
    expect(backendMocks.getClubName).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("propagates canister event lookup failure rather than presenting not found", async () => {
    const denied = new Error("event read unavailable");
    backendMocks.events.mockRejectedValueOnce(denied);
    const client = { from: vi.fn() };

    await expect(fetchEventDetail(client, "event-icp")).rejects.toBe(denied);
    expect(client.from).not.toHaveBeenCalled();
  });
});
