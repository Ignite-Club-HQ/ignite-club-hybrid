import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export async function fetchReportExtras(
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
    .select("id, title, event_date, opponent, final_score_home, final_score_away")
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
    supabase
      .from("game_results")
      .select("event_id, home_label, away_label, home_score, away_score, period_scores, player_stats")
      .in("event_id", eventIds),
    supabase.from("match_captains").select("event_id, user_id, child_id").in("event_id", eventIds),
    supabase.from("player_of_match").select("event_id, user_id, child_id").in("event_id", eventIds),
    supabase
      .from("match_goalkeepers")
      .select("event_id, user_id, child_id")
      .in("event_id", eventIds),
    supabase
      .from("game_player_stats")
      .select("event_id, user_id, child_id, goals_scored, positions_played, position_minutes")
      .eq("team_id", teamId)
      .in("event_id", eventIds),
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
      if (resultByEvent.has(e.id)) return;
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
      const homeScore = gr?.home_score ?? event.final_score_home ?? null;
      const awayScore = gr?.away_score ?? event.final_score_away ?? null;
      const result =
        homeScore == null || awayScore == null
          ? null
          : homeScore > awayScore
            ? "W"
            : homeScore < awayScore
              ? "L"
              : "D";
      const matchScorers = extractScorers(gr?.player_stats);
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
        playerGoals: goalsByEvent.get(event.id) ?? 0,
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
