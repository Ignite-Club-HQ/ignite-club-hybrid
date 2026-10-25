import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readHistoryResult } from "@/features/competitions/history/historyRepository";
import { readReportPlayerStats } from "@/features/competitions/history/reportRepository";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveTeam } from "@/live/features/club";
import {
  listLiveEvents,
  getLiveGameResult,
  getLivePlayerStatsReport,
  listLiveDetailedGamePlayerStats,
  readLiveEventHonours,
} from "@/live/features/events";

/**
 * Match-level context + per-player honours for the Player Stats report.
 *
 * Scores live on `game_results` (with the event's own `final_score_*` as a
 * fallback), and captain / player-of-the-match / goalkeeper appointments live
 * in their own tables — none of which are reachable from
 * `game_player_stats`. This module joins them all for a report range.
 *
 * Players may be either app users (`user_id`) or registered children
 * (`child_id`), so every tally is keyed by whichever is present.
 */

export type PlayerKey = string;

export function playerKey(userId?: string | null, childId?: string | null): PlayerKey {
  return userId ? `u:${userId}` : childId ? `c:${childId}` : "";
}

const GK_POSITION = /^gk$|goal\s*keep|keeper/i;

export function isGoalkeeperPosition(position: string): boolean {
  return GK_POSITION.test(position.trim());
}

export interface ReportScorer {
  id: string;
  name: string;
  goals: number;
}

export interface ReportMatch {
  eventId: string;
  title: string;
  eventDate: string | null;
  opponent: string | null;
  homeLabel: string | null;
  awayLabel: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** W / D / L from our team's perspective, or null when there's no score. */
  result: "W" | "D" | "L" | null;
  periodScores: Array<{ home: number; away: number }>;
  captainNames: string[];
  pomNames: string[];
  goalkeeperNames: string[];
  /** Sum of players' recorded goals — used to flag reconciliation gaps. */
  playerGoals: number;
  /** Goal scorers entered via the Match Result sheet (game_results.player_stats). */
  scorers: ReportScorer[];
}

export interface ScorerAgg {
  name: string;
  goals: number;
  games: number;
}

export interface PlayerHonours {
  captain: number;
  pom: number;
  gkMatches: number;
  gkAppointed: number;
  gkSeconds: number;
}

/** Production reports count appointments when recorded goalkeeper appearances are absent. */
export function reportedGoalkeeperMatches(honours: Pick<PlayerHonours, "gkMatches" | "gkAppointed">): number {
  return Math.max(honours.gkMatches, honours.gkAppointed);
}

export interface ReportExtras {
  matches: ReportMatch[];
  honours: Record<PlayerKey, PlayerHonours>;
  /** Goal scorers aggregated across all matches from game_results.player_stats.
   *  Keyed by player id (user_id or child_id) so the report can show goals
   *  even when no pitch-board session was tracked. */
  scorersByPlayer: Record<string, ScorerAgg>;
  totals: {
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
  };
}

function emptyHonours(): PlayerHonours {
  return { captain: 0, pom: 0, gkMatches: 0, gkAppointed: 0, gkSeconds: 0 };
}

function bump(
  map: Record<PlayerKey, PlayerHonours>,
  key: PlayerKey,
  field: keyof PlayerHonours,
  by = 1,
) {
  if (!key) return;
  if (!map[key]) map[key] = emptyHonours();
  map[key][field] += by;
}

async function resolveNames(
  userIds: string[],
  childIds: string[],
): Promise<Record<PlayerKey, string>> {
  const names: Record<PlayerKey, string> = {};
  if (userIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const row of data ?? []) {
      names[playerKey(row.id, null)] = row.display_name || "Unknown";
    }
  }
  if (childIds.length > 0) {
    const { data } = await supabase.from("children").select("id, name").in("id", childIds);
    for (const row of data ?? []) {
      names[playerKey(null, row.id)] = row.name || "Unknown";
    }
  }
  return names;
}

function normalisePeriods(raw: unknown): Array<{ home: number; away: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p: any) => ({
      home: Number(p?.home ?? p?.home_score ?? 0) || 0,
      away: Number(p?.away ?? p?.away_score ?? 0) || 0,
    }))
    .filter((p) => Number.isFinite(p.home) && Number.isFinite(p.away));
}

/**
 * ICP counterpart of fetchReportExtras. Honours (captain/vice/MVP/goalkeeper
 * counts) come straight from events_domain.get_player_stats_report, which
 * aggregates GameResult/MatchCaptainAssignment/MatchGoalkeeperAssignment over
 * the requested date range — a canister-native version of the Supabase
 * match_captains/player_of_match/match_goalkeepers joins above. Per-match
 * score detail is reconstructed from list_events + get_game_result since
 * there is no canister-side join for that.
 */
async function fetchReportExtrasIcp(
  teamId: string,
  opts: { eventId?: string; dateRange?: { from: Date; to: Date } },
): Promise<ReportExtras> {
  const empty: ReportExtras = {
    matches: [],
    honours: {},
    scorersByPlayer: {},
    totals: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0 },
  };

  return withFeatureBackend("events", {
    supabase: async () => empty,
    icp: async (ctx) => {
      const teamRows = await getLiveTeam(ctx, teamId);
      const team = teamRows[0];
      if (!team) return empty;

      const allEvents = await listLiveEvents(ctx, null, teamId);
      const games = (allEvents ?? []).filter((e: any) => e.event_type === "game" && !e.deleted);

      let fromMs: number;
      let toMs: number;
      let scopedEvents = games;
      if (opts.eventId) {
        scopedEvents = games.filter((e: any) => e.id === opts.eventId);
        if (scopedEvents.length === 0) return empty;
        fromMs = Number(scopedEvents[0].starts_at_ms);
        toMs = fromMs;
      } else if (opts.dateRange) {
        fromMs = opts.dateRange.from.getTime();
        toMs = opts.dateRange.to.getTime();
        scopedEvents = games.filter((e: any) => {
          const ms = Number(e.starts_at_ms);
          return ms >= fromMs && ms <= toMs;
        });
      } else {
        return empty;
      }
      if (scopedEvents.length === 0) return empty;

      const statRows = await getLivePlayerStatsReport(ctx, team.club_id, teamId, fromMs, toMs);
      const honours: Record<PlayerKey, PlayerHonours> = {};
      (statRows ?? []).forEach((row: any) => {
        const key = playerKey(row.ref_kind === "account" ? row.ref_id : null, row.ref_kind === "child" ? row.ref_id : null);
        if (!key) return;
        honours[key] = {
          captain: Number(row.captain_count) || 0,
          pom: Number(row.mvp_count) || 0,
          gkMatches: 0,
          gkAppointed: Number(row.goalkeeper_count) || 0,
          gkSeconds: 0,
        };
      });

      const matches: ReportMatch[] = [];
      const scorersByPlayer: Record<string, ScorerAgg> = {};
      for (const event of scopedEvents as any[]) {
        const [result,assignments,stats] = await Promise.all([getLiveGameResult(ctx,event.id),readLiveEventHonours(ctx,event.id),listLiveDetailedGamePlayerStats(ctx,event.id)]);
        const {listLiveProfilesByIds}=await import("@/live/features/identityAccessClient");
        const accountIds=[...assignments.captains,...assignments.goalkeepers].flatMap(a=>a.ref_kind==="account"?[a.ref_id]:[]);
        const profiles=await listLiveProfilesByIds(ctx,accountIds);
        const names=new Map(profiles.map(p=>[p.account_id,p.display_name]));
        const {resolveLivePiiTextBatch}=await import("@/live/features/vault");
        const childNames=await resolveLivePiiTextBatch(ctx,[...assignments.captains,...assignments.goalkeepers].flatMap(a=>a.ref_kind==="child"?[a.ref_id]:[]),"name","competition_report_honours","Authorized report honours");
        const nameFor=(a:(typeof assignments.captains)[number])=>a.ref_kind==="account"?names.get(a.ref_id)??"Player":childNames.get(a.ref_id)??"Player";
        const goalkeeperPlayers = new Set<PlayerKey>();
        for(const stat of stats) {
          const key=playerKey(stat.user_id[0],stat.child_id);if(!key)continue;
          const gkSeconds=Object.entries(stat.position_minutes??{}).reduce((total,[position,seconds])=>total+(isGoalkeeperPosition(position)?seconds:0),0);
          if(gkSeconds>0)bump(honours,key,"gkSeconds",gkSeconds);
          if(gkSeconds>0 || stat.positions_played.some(isGoalkeeperPosition)) goalkeeperPlayers.add(key);
        }
        for (const key of goalkeeperPlayers) bump(honours, key, "gkMatches");
        const gr = result && result.length ? result[0] : null;
        const homeScore = gr?.scores_hidden || gr?.home_score[0] == null ? null : Number(gr.home_score[0]);
        const awayScore = gr?.scores_hidden || gr?.away_score[0] == null ? null : Number(gr.away_score[0]);
        const parseArray=(text:unknown):unknown[]=>{if(typeof text!=="string")return [];try{const row:unknown=JSON.parse(text);return Array.isArray(row)?row:[]}catch{return []}};
        const scorers:ReportScorer[]=gr?.scores_hidden?[]:parseArray(gr?.player_stats_json).flatMap(raw=>{
          if(!raw || typeof raw!=="object")return [];const r=raw as Record<string,unknown>;
          return typeof r.id==="string" && r.id!=="__own__" && typeof r.name==="string" && typeof r.goals==="number" && Number.isFinite(r.goals) && r.goals>0?[{id:r.id,name:r.name,goals:r.goals}]:[];
        });
        for(const scorer of scorers){const previous=scorersByPlayer[scorer.id];scorersByPlayer[scorer.id]={name:scorer.name,goals:(previous?.goals??0)+scorer.goals,games:(previous?.games??0)+1}}
        const outcome =
          homeScore == null || awayScore == null
            ? null
            : homeScore > awayScore
              ? "W"
              : homeScore < awayScore
                ? "L"
                : "D";
        matches.push({
          eventId: event.id,
          title: event.title,
          eventDate: new Date(Number(event.starts_at_ms)).toISOString(),
          opponent: event.opponent?.[0] ?? gr?.away_label ?? null,
          homeLabel: (gr?.home_label as string | undefined) ?? null,
          awayLabel: (gr?.away_label as string | undefined) ?? null,
          homeScore,
          awayScore,
          result: outcome as ReportMatch["result"],
          periodScores: gr?.scores_hidden?[]:normalisePeriods(parseArray(gr?.period_scores_json)),
          captainNames: assignments.captains.map(nameFor),
          pomNames: gr?.mvp_player_name?.[0] ? [gr.mvp_player_name[0]] : [],
          goalkeeperNames: assignments.goalkeepers.map(nameFor),
          playerGoals: gr?.scores_hidden?0:stats.reduce((total,s)=>total+Number(s.goals_scored),0),
          scorers,
        });
      }

      const scored = matches.filter((m) => m.result !== null);
      const totals = {
        played: scored.length,
        won: scored.filter((m) => m.result === "W").length,
        drawn: scored.filter((m) => m.result === "D").length,
        lost: scored.filter((m) => m.result === "L").length,
        goalsFor: scored.reduce((sum, m) => sum + (m.homeScore ?? 0), 0),
        goalsAgainst: scored.reduce((sum, m) => sum + (m.awayScore ?? 0), 0),
        goalDifference: 0,
      };
      totals.goalDifference = totals.goalsFor - totals.goalsAgainst;

      return { matches, honours, scorersByPlayer, totals };
    },
  }, { teamId: teamId });
}

export async function fetchReportExtras(
  teamId: string,
  opts: { eventId?: string; dateRange?: { from: Date; to: Date } },
): Promise<ReportExtras> {
  if (resolveAuthBackend() === "icp") return fetchReportExtrasIcp(teamId, opts);
  return fetchReportExtrasSupabase(teamId, opts);
}

async function fetchReportExtrasSupabase(
  teamId: string,
  opts: { eventId?: string; dateRange?: { from: Date; to: Date } },
): Promise<ReportExtras> {
  const empty: ReportExtras = {
    matches: [],
    honours: {},
    scorersByPlayer: {},
    totals: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0 },
  };


  let eventsQuery = supabase
    .from("events")
    .select("id, title, event_date, opponent, competition_match_id")
    .eq("team_id", teamId)
    .eq("type", "game");

  if (opts.eventId) {
    eventsQuery = eventsQuery.eq("id", opts.eventId);
  } else if (opts.dateRange) {
    eventsQuery = eventsQuery
      .gte("event_date", opts.dateRange.from.toISOString())
      .lte("event_date", opts.dateRange.to.toISOString());
  } else {
    return empty;
  }

  const { data: events } = await eventsQuery;
  const eventIds = (events ?? []).map((e) => e.id);
  if (eventIds.length === 0) return empty;

  const [resultsRes, captainsRes, pomRes, gkRes, statsRes] = await Promise.all([
    Promise.all(eventIds.map(id=>readHistoryResult(id))).then(rows=>({data:rows.filter(row=>row!==null)})),
    supabase.from("match_captains").select("event_id, user_id, child_id").in("event_id", eventIds),
    supabase.from("player_of_match").select("event_id, user_id, child_id").in("event_id", eventIds),
    supabase
      .from("match_goalkeepers")
      .select("event_id, user_id, child_id")
      .in("event_id", eventIds),
    readReportPlayerStats(teamId,opts.eventId,opts.dateRange).then(data=>({data:data.filter(row=>eventIds.includes(row.event_id))})),
  ]);

  const captains = captainsRes.data ?? [];
  const poms = pomRes.data ?? [];
  const gks = gkRes.data ?? [];
  const stats = statsRes.data ?? [];

  const honours: Record<PlayerKey, PlayerHonours> = {};
  captains.forEach((r: any) => bump(honours, playerKey(r.user_id, r.child_id), "captain"));
  poms.forEach((r: any) => bump(honours, playerKey(r.user_id, r.child_id), "pom"));
  gks.forEach((r: any) => bump(honours, playerKey(r.user_id, r.child_id), "gkAppointed"));

  // Derived goalkeeper appearances so rotation fairness is visible even when
  // nobody used the appointment UI.
  const derivedGkByEvent = new Map<string, Set<PlayerKey>>();
  stats.forEach((row: any) => {
    const key = playerKey(row.user_id, row.child_id);
    if (!key) return;
    const positions: string[] = Array.isArray(row.positions_played) ? row.positions_played : [];
    const minutes = (row.position_minutes ?? {}) as Record<string, number>;
    let gkSeconds = 0;
    Object.entries(minutes).forEach(([pos, secs]) => {
      if (isGoalkeeperPosition(pos)) gkSeconds += Number(secs) || 0;
    });
    const playedGk = positions.some(isGoalkeeperPosition) || gkSeconds > 0;
    if (gkSeconds > 0) bump(honours, key, "gkSeconds", gkSeconds);
    if (playedGk) {
      const set = derivedGkByEvent.get(row.event_id) ?? new Set<PlayerKey>();
      set.add(key);
      derivedGkByEvent.set(row.event_id, set);
    }
  });
  derivedGkByEvent.forEach((keys) => keys.forEach((key) => bump(honours, key, "gkMatches")));

  // Names for the per-match section.
  const userIds = new Set<string>();
  const childIds = new Set<string>();
  [...captains, ...poms, ...gks].forEach((r: any) => {
    if (r.user_id) userIds.add(r.user_id);
    if (r.child_id) childIds.add(r.child_id);
  });
  const names = await resolveNames([...userIds], [...childIds]);
  const nameFor = (r: any) => names[playerKey(r.user_id, r.child_id)] || "Unknown";

  const resultByEvent = new Map<string, any>();
  (resultsRes.data ?? []).forEach((r: any) => resultByEvent.set(r.event_id, r));

  // Recover pitch-board results that were saved without a linked fixture
  // (event_id IS NULL) by matching them to a game on the same calendar day.
  const unlinkedDates = (events ?? [])
    .map((e: any) => (e.event_date ? String(e.event_date).slice(0, 10) : null))
    .filter(Boolean) as string[];
  if (unlinkedDates.length > 0) {
    const { data: orphans } = await supabase
      .from("game_results")
      .select("home_label, away_label, home_score, away_score, period_scores, player_stats, created_at")
      .eq("team_id", teamId)
      .is("event_id", null);
    const orphanByDate = new Map<string, any>();
    (orphans ?? []).forEach((r: any) => {
      const day = String(r.created_at ?? "").slice(0, 10);
      if (day && !orphanByDate.has(day)) orphanByDate.set(day, r);
    });
    (events ?? []).forEach((e: any) => {
      if (resultByEvent.has(e.id) || e.competition_match_id) return;
      const day = e.event_date ? String(e.event_date).slice(0, 10) : null;
      const match = day ? orphanByDate.get(day) : null;
      if (match) resultByEvent.set(e.id, match);
    });
  }

  const goalsByEvent = new Map<string, number>();
  stats.forEach((row: any) => {
    goalsByEvent.set(row.event_id, (goalsByEvent.get(row.event_id) ?? 0) + (row.goals_scored || 0));
  });

  // Extract goal scorers from game_results.player_stats JSON so the report
  // can show goals even when no pitch-board session was tracked.
  const scorersByPlayer: Record<string, ScorerAgg> = {};
  const extractScorers = (raw: unknown): ReportScorer[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p: any) => ({
        id: String(p?.id ?? ""),
        name: String(p?.name ?? "Player"),
        goals: Number(p?.goals) || 0,
      }))
      .filter((s) => s.id && s.id !== "__own__" && s.goals > 0);
  };

  const matches: ReportMatch[] = (events ?? [])
    .map((event: any) => {
      const gr = resultByEvent.get(event.id);
      const homeScore = gr?.scores_hidden ? null : gr?.home_score ?? null;
      const awayScore = gr?.scores_hidden ? null : gr?.away_score ?? null;
      const result =
        homeScore == null || awayScore == null
          ? null
          : homeScore > awayScore
            ? "W"
            : homeScore < awayScore
              ? "L"
              : "D";
      const matchScorers = gr?.scores_hidden ? [] : extractScorers(gr?.player_stats);
      // Aggregate per-player goals across all matches in the range.
      matchScorers.forEach((s) => {
        const existing = scorersByPlayer[s.id];
        if (existing) {
          existing.goals += s.goals;
          existing.games += 1;
        } else {
          scorersByPlayer[s.id] = { name: s.name, goals: s.goals, games: 1 };
        }
      });
      return {
        eventId: event.id,
        title: event.title,
        eventDate: event.event_date ?? null,
        opponent: event.opponent ?? gr?.away_label ?? null,
        homeLabel: gr?.home_label ?? null,
        awayLabel: gr?.away_label ?? null,
        homeScore,
        awayScore,
        result: result as ReportMatch["result"],
        periodScores: normalisePeriods(gr?.period_scores),
        captainNames: captains.filter((c: any) => c.event_id === event.id).map(nameFor),
        pomNames: poms.filter((c: any) => c.event_id === event.id).map(nameFor),
        goalkeeperNames: gks.filter((c: any) => c.event_id === event.id).map(nameFor),
        playerGoals: gr?.scores_hidden ? 0 : goalsByEvent.get(event.id) ?? 0,
        scorers: matchScorers,
      } satisfies ReportMatch;
    })
    .sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? ""));

  const scored = matches.filter((m) => m.result !== null);
  const totals = {
    played: scored.length,
    won: scored.filter((m) => m.result === "W").length,
    drawn: scored.filter((m) => m.result === "D").length,
    lost: scored.filter((m) => m.result === "L").length,
    goalsFor: scored.reduce((sum, m) => sum + (m.homeScore ?? 0), 0),
    goalsAgainst: scored.reduce((sum, m) => sum + (m.awayScore ?? 0), 0),
    goalDifference: 0,
  };
  totals.goalDifference = totals.goalsFor - totals.goalsAgainst;

  return { matches, honours, scorersByPlayer, totals };
}

export function useReportExtras(
  teamId: string,
  opts: { eventId?: string; dateRange?: { from: Date; to: Date } },
) {
  return useQuery({
    queryKey: [
      "player-stats-report-extras",
      teamId,
      opts.eventId ?? null,
      opts.dateRange?.from?.toISOString() ?? null,
      opts.dateRange?.to?.toISOString() ?? null,
    ],
    queryFn: () => fetchReportExtras(teamId, opts),
    enabled: !!teamId && (!!opts.eventId || !!opts.dateRange),
  });
}
