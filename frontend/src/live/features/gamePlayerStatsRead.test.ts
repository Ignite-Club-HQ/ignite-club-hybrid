import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), names: vi.fn(), events: vi.fn(),detailed:vi.fn() }));
vi.mock("../domains", () => ({ connectLiveEventsDomain: async () => ({ actor: { list_game_player_stats: mocks.read, read_competition_events: mocks.events,read_detailed_game_player_stats:mocks.detailed } }) }));
vi.mock("./vault", () => ({ resolveLivePiiTextBatch: mocks.names, grantLiveClubPiiRead: vi.fn(), registerLivePiiText: vi.fn() }));
import { listLiveGamePlayerStats, listLiveCompetitionEvents,listLiveDetailedGamePlayerStats } from "./events";
import type { FeatureBackendContext } from "../featureRouter";
describe("authorized game stats read", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.names.mockResolvedValue(new Map()); });
  it("maps exact child identity and seconds without a Supabase read",async()=>{
    mocks.detailed.mockResolvedValue({Ok:[{stat:{fill_in_player_name:[],minutes_played:120},detail:[{child_id:["child-1"],position_seconds:[[["GK",120]]]}]}]});
    const rows=await listLiveDetailedGamePlayerStats({} as FeatureBackendContext,"event-1");
    expect(rows[0].child_id).toBe("child-1");expect(rows[0].position_minutes).toEqual({GK:120});
  });
  it("awaits the actual actor result before mapping player records", async () => {
    const row = { fill_in_player_name: [], minutes_played: 30 };
    mocks.read.mockResolvedValue({ Ok: [row] });
    expect(await listLiveGamePlayerStats({} as FeatureBackendContext, "event-1")).toEqual([row]);
    expect(mocks.read).toHaveBeenCalledWith("event-1");
  });
  it("propagates denied reads instead of rendering an empty report", async () => {
    mocks.read.mockResolvedValue({ Err: "Event access forbidden" });
    await expect(listLiveGamePlayerStats({} as FeatureBackendContext, "event-1")).rejects.toThrow("Event access forbidden");
    expect(mocks.names).not.toHaveBeenCalled();
  });
  it("uses exact competition association rather than ordinary team events", async () => {
    mocks.events.mockResolvedValue({ Ok: [{ id: "cup-event" }] });
    expect(await listLiveCompetitionEvents({} as FeatureBackendContext, "cup")).toEqual([{ id: "cup-event" }]);
    expect(mocks.events).toHaveBeenCalledWith("cup");
  });
});