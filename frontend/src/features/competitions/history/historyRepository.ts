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
  notes?: string | null;
  events?: { id: string; title: string | null; start_time: string | null } | null;
  teams?: { id: string; name: string } | null;
}

export const historyRpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

/** A single caller-authorized read for calendar, result editor and reports. */
export async function readHistoryResult(eventId: string): Promise<HistoryResult | null> {
  return withFeatureBackend("events", {
    supabase: async () => {
      const {data,error} = await historyRpc("read_game_result",{p_event_id:eventId});
      if (error) throw new Error(error.message);
      return data as HistoryResult | null;
    },
    icp: async (ctx) => {
      const {getLiveGameResult} = await import("@/live/features/events");
      const [row] = await getLiveGameResult(ctx,eventId);
      if (!row) return null;
      return { ...row, id:String(row.id),team_id:String(row.team_id),event_id:eventId,
        sport:String(row.sport),home_label:String(row.home_label),away_label:String(row.away_label),
        home_score:optionalScore(row.home_score),away_score:optionalScore(row.away_score),
        scores_hidden:row.scores_hidden===true, period_scores:JSON.parse(String(row.period_scores_json ?? "[]")),
        player_stats:jsonArray<SummaryPlayerStat>(row.player_stats_json),
        mvp_player_id:Array.isArray(row.mvp_player_id)?row.mvp_player_id[0]??null:null,
        mvp_player_name:row.mvp_player_name[0]??null, notes:null,
        saved_by:String(row.saved_by),played_at:new Date(Number(row.updated_at_ms)).toISOString(),
      } as HistoryResult;
    },
  },{eventId});
}

export interface HistoryWrite {
  team_id:string; event_id:string|null; sport:string; home_label:string; away_label:string;
  home_score:number;away_score:number;period_scores:unknown;player_stats:unknown;
  mvp_player_id?:string|null;mvp_player_name?:string|null;notes?:string|null;
}
export async function saveHistoryResult(row:HistoryWrite,onlyIfMissing=false):Promise<void> {
  await withFeatureBackend("events",{
    supabase:async()=>{
      const {error}=await historyRpc("save_game_history",{p_result:row,p_only_if_missing:onlyIfMissing});
      if(error) throw new Error(error.message);
    },
    icp:async(ctx)=>{
      const {saveLiveGameResult}=await import("@/live/features/events");
      await saveLiveGameResult(ctx,{teamId:row.team_id,eventId:row.event_id,sport:row.sport,
        homeLabel:row.home_label,awayLabel:row.away_label,homeScore:row.home_score,awayScore:row.away_score,
        periodScoresJson:JSON.stringify(row.period_scores),playerStatsJson:JSON.stringify(row.player_stats),
        mvpPlayerId:row.mvp_player_id??null,mvpPlayerName:row.mvp_player_name??null});
    },
  },{teamId:row.team_id,writeKey:"once",attempts:1});
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

export async function deleteHistory(row: HistoryResult): Promise<void> {
  return withFeatureBackend("events", {
    supabase: async () => {
      const { error } = await supabase.from("game_results").delete().eq("id",row.id);
      if (error) throw error;
    },
    icp: async (ctx) => {
      if (!row.event_id) throw new Error("Saved game has no linked event.");
      const { deleteLiveGameResult } = await import("@/live/features/events");
      await deleteLiveGameResult(ctx,row.event_id);
    },
  }, { teamId: row.team_id, writeKey: "once", attempts: 1 });
}