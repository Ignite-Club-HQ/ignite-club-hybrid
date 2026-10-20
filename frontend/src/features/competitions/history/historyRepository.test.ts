import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  rpc: vi.fn(), events: vi.fn(), result: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, providers: any) =>
  mocks.mode === "icp" ? providers.icp({}) : providers.supabase() }));
vi.mock("@/live/features/events", () => ({ listLiveEvents: mocks.events, getLiveGameResult: mocks.result }));
import { listHistory } from "./historyRepository";
beforeEach(() => { vi.clearAllMocks(); });
describe("preserved History read boundary", () => {
  it("keeps the game and MVP without revealing a masked score", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: "history-1", home_score: null, away_score: null,
      scores_hidden: true, mvp_player_name: "MVP", period_scores: [], player_stats: [] }], error: null });
    mocks.events.mockResolvedValue([{ id: "event-1", event_type: "game", deleted: false, starts_at_ms: 1n, title: "Cup" }]);
    mocks.result.mockResolvedValue([{ id: "history-1", team_id: "team-1", sport: "basketball",
      home_label: "Home", away_label: "Away", home_score: null, away_score: null, scores_hidden: true,
      mvp_player_name: ["MVP"], mvp_player_id: ["player-1"], saved_by: "manager", period_scores_json: "[]", player_stats_json: "[]" }]);
    const rows = await listHistory({ teamId: "team-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("history-1");
    expect(rows[0].home_score).toBeNull();
    expect(rows[0].away_score).toBeNull();
    expect(rows[0].mvp_player_name).toBe("MVP");
    expect(rows[0].period_scores).toEqual([]);
  });
  it("preserves visible scores and detailed quarter/player records", async () => {
    const periods = [{ quarter: 1, home: 23, away: 17 }];
    const players = [{ id: "player-1", name: "MVP", points: 23, secondsPlayed: 120 }];
    mocks.rpc.mockResolvedValue({ data: [{ id: "history-1", home_score: 23, away_score: 17,
      period_scores: periods, player_stats: players }], error: null });
    mocks.events.mockResolvedValue([{ id: "event-1", event_type: "game", deleted: false, starts_at_ms: 1n, title: "Cup" }]);
    mocks.result.mockResolvedValue([{ id: "history-1", team_id: "team-1", sport: "basketball",
      home_label: "Home", away_label: "Away", home_score: 23, away_score: 17, scores_hidden: false,
      mvp_player_name: [], saved_by: "manager", period_scores_json: JSON.stringify(periods), player_stats_json: JSON.stringify(players) }]);
    const [row] = await listHistory({ teamId: "team-1" });
    expect(row.home_score).toBe(23);
    expect(row.away_score).toBe(17);
    expect(row.period_scores).toEqual(periods);
    expect(row.player_stats).toEqual(players);
  });
  it("propagates denied reads instead of falling back to raw result storage", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    mocks.events.mockRejectedValue(new Error("denied"));
    await expect(listHistory({ teamId: "team-1" })).rejects.toThrow("denied");
  });
  it("does not expose raw History when the protected endpoint is absent",async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code:"PGRST202",message:"endpoint missing"}});
    mocks.events.mockRejectedValue(new Error("endpoint missing"));
    await expect(listHistory({teamId:"team-1"})).rejects.toThrow("endpoint missing");
  });
});