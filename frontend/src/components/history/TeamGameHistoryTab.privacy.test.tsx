import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/features/competitions/history/historyRepository", () => ({ listHistory: mocks.list, deleteHistory: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import TeamGameHistoryTab from "./TeamGameHistoryTab";
beforeEach(() => vi.clearAllMocks());
const row = { id: "game-1", team_id: "team-1", event_id: "event-1", sport: "basketball",
 home_label: "Riverside", away_label: "Hilltown", home_score: null, away_score: null,
 scores_hidden: true, period_scores: [], player_stats: [], mvp_player_id: "player-1",
 mvp_player_name: "Taylor", played_at: "2026-10-20T00:00:00Z", saved_by: "manager" };
function mount() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 return render(<QueryClientProvider client={client}><TeamGameHistoryTab teamId="team-1" teamName="Riverside" canManage={false} /></QueryClientProvider>);
}
describe("History protected-result rendering", () => {
 it("keeps the match and MVP while omitting a win/loss/draw for hidden scores", async () => {
   mocks.list.mockResolvedValue([row]); mount();
   await waitFor(() => expect(screen.getByText("Scores hidden")).toBeTruthy());
   expect(screen.getByText("MVP Taylor")).toBeTruthy();
   expect(screen.queryByText("DRAW")).toBeNull();
   expect(screen.queryByText("WIN")).toBeNull();
   expect(screen.queryByText("LOSS")).toBeNull();
   expect(screen.getByRole("button",{name:"View game summary"})).toBeTruthy();
 });
 it("shows the genuine result for an authorized visible read", async () => {
   mocks.list.mockResolvedValue([{...row,home_score:23,away_score:17,scores_hidden:false}]); mount();
   await waitFor(() => expect(screen.getByText("WIN")).toBeTruthy());
   expect(screen.getByText("23–17")).toBeTruthy();
 });
});