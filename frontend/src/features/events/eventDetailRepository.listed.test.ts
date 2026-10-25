import { beforeEach, describe, expect, it, vi } from "vitest";

const listed = new Map<string, any>();
const listLiveEvents = vi.fn();
const scopes: unknown[] = [];
vi.mock("@/live/features/events", () => ({
  getListedLiveEvent: (id: string) => listed.get(id) ?? null,
  listLiveEvents: (...args: unknown[]) => listLiveEvents(...args),
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_f: string, impl: any, scope: unknown) => { scopes.push(scope); return impl.icp({}); },
}));
vi.mock("@/lib/clubTeamCache", () => ({ getCachedTeam: () => null, getCachedClub: () => ({ name: "Giddy Goat" }) }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: vi.fn(), getLiveClubProfile: vi.fn() }));

import { fetchEventDetail, listedEventDetailPreview } from "./eventDetailRepository";

const raw = { id: "e1", club_id: "c1", team_id: [], title: "Game day", event_type: "game", starts_at_ms: 1_800_000_000_000n, ends_at_ms: 0n, cancelled: false, series_id: [], address: [], location: [], mini_league_id: [], opponent: [] };

describe("opening a listed event", () => {
  beforeEach(() => { listed.clear(); scopes.length = 0; listLiveEvents.mockReset(); });

  it("shows an event already listed this session immediately", () => {
    expect(listedEventDetailPreview("e1")).toBeUndefined();
    listed.set("e1", raw);
    expect(listedEventDetailPreview("e1")).toMatchObject({ id: "e1", title: "Game day", club_id: "c1", type: "game" });
  });

  it("refreshes only the event's own club when it is known", async () => {
    listed.set("e1", raw);
    listLiveEvents.mockResolvedValue([raw]);
    await fetchEventDetail(null, "e1");
    expect(listLiveEvents).toHaveBeenCalledWith(expect.anything(), "c1");
    expect(scopes[0]).toEqual({ clubId: "c1" });
  });
});
