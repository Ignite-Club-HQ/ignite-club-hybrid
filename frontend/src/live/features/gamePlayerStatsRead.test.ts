import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), names: vi.fn() }));
vi.mock("../domains", () => ({ connectLiveEventsDomain: async () => ({ actor: { list_game_player_stats: mocks.read } }) }));
vi.mock("./vault", () => ({ resolveLivePiiTextBatch: mocks.names, grantLiveClubPiiRead: vi.fn(), registerLivePiiText: vi.fn() }));
import { listLiveGamePlayerStats } from "./events";
import type { FeatureBackendContext } from "../featureRouter";
describe("authorized game stats read", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.names.mockResolvedValue(new Map()); });
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
});