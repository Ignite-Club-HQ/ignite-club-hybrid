import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { optionalScore } from "./resultVisibility";
import type { PerQuarterScore, SummaryPlayerStat } from "@/components/scoreboard/GameSummaryDialog";

export interface HistoryResult {
  id: string;
  team_id: string;
  event_id: string | null;
  sport: "basketball" | "netball";
  home_label: string;
  away_label: string;
  home_score: number | null;
  away_score: number | null;
  scores_hidden: boolean;
  period_scores: PerQuarterScore[];
  player_stats: SummaryPlayerStat[];
  mvp_player_id: string | null;
  mvp_player_name: string | null;
  played_at: string;
  saved_by: string;
  events?: { id: string; title: string | null; start_time: string | null } | null;
  teams?: { id: string; name: string } | null;
}

function jsonArray<T>(value: unknown): T[] {
  if (typeof value === "string") {
    try { return jsonArray<T>(JSON.parse(value)); } catch { return []; }
  }
  return Array.isArray(value) ? value as T[] : [];
}

/** Do not fall back to raw History on denied protected reads. */
export async function listHistory(scope: { teamId?: string; clubId?: string }, limit = 100): Promise<HistoryResult[]> {
  return withFeatureBackend("events", {
    supabase: async () => {
      // The staged SQL introduces this bounded, caller-authorized DTO endpoint.
      const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
      const { data, error } = await rpc("read_game_history", {
        p_team_id: scope.teamId ?? null, p_club_id: scope.clubId ?? null,
        p_limit: Math.max(1, Math.min(limit, 100)),
      });
      if (error?.code === "PGRST202") {
        // Compatibility before the preservation migration is installed. This
        // is still a caller-RLS read, never a retry after authorization denial.
        let query = supabase.from("game_results")
          .select("*, events:event_id(id,title,start_time), teams:team_id(id,name,club_id)")
          .order("played_at", { ascending: false }).limit(Math.min(limit,100));
        if (scope.teamId) query = query.eq("team_id",scope.teamId);
        if (!scope.teamId && scope.clubId) {
          const { data: teams, error: teamError } = await supabase.from("teams").select("id").eq("club_id",scope.clubId);
          if (teamError) throw teamError;
          if (!teams?.length) return [];
          query = query.in("team_id",teams.map((team) => team.id));
        }
        const { data: legacy, error: legacyError } = await query;
        if (legacyError) throw legacyError;
        return (legacy ?? []).map((row) => ({ ...row, scores_hidden: false })) as unknown as HistoryResult[];
      }
      if (error) throw new Error(error.message);
      return jsonArray<HistoryResult>(data);
    },
    icp: async (ctx) => {
      const { listLiveEvents, getLiveGameResult } = await import("@/live/features/events");
      const events = await listLiveEvents(ctx, scope.clubId ?? null, scope.teamId ?? null);
      const games = events.filter((event) => event.event_type === "game" && !event.deleted)
        .sort((a, b) => Number(b.starts_at_ms) - Number(a.starts_at_ms));
      const rows: HistoryResult[] = [];
      // Bounded sequential reads avoid burst traffic and stop once the page is full.
      for (const event of games) {
        if (rows.length >= Math.min(limit, 100)) break;
        const result = await getLiveGameResult(ctx, event.id);
        const row = result[0];
        if (!row) continue;
        const home = optionalScore(row.home_score);
        const away = optionalScore(row.away_score);
        const hidden = row.scores_hidden === true;
        rows.push({
          id: String(row.id), team_id: String(row.team_id), event_id: event.id,
          sport: row.sport === "basketball" ? "basketball" : "netball",
          home_label: String(row.home_label), away_label: String(row.away_label),
          home_score: hidden ? null : home, away_score: hidden ? null : away, scores_hidden: hidden,
          period_scores: hidden ? [] : jsonArray<PerQuarterScore>(row.period_scores_json),
          player_stats: jsonArray<SummaryPlayerStat>(row.player_stats_json),
          mvp_player_id: Array.isArray(row.mvp_player_id) ? row.mvp_player_id[0] ?? null : null,
          mvp_player_name: row.mvp_player_name[0] ?? null,
          played_at: new Date(Number(event.starts_at_ms)).toISOString(), saved_by: String(row.saved_by),
          events: { id: event.id, title: event.title, start_time: null },
        });
      }
      return rows;
    },
  }, scope);
}