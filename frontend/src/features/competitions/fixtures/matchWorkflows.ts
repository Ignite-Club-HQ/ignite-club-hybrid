import { writeOnce } from "@/live/clubScope";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  deleteLiveMatch,
  recordLiveMatch,
  setLiveMatchResult,
  trimLiveCompetitionRounds,
  updateLiveMatchDetails,
} from "@/live/features/competitions";

export interface MatchMutationError {
  message: string;
}

export interface MatchMutationResult {
  error: MatchMutationError | null;
}

export interface BuildResultUpdateInput {
  homeScore: string;
  awayScore: string;
  status: string;
  source?: string | null;
  manuallyOverriddenAt?: string | null;
  now?: () => Date;
}

export interface MatchResultUpdate {
  payload: Record<string, unknown>;
  nextStatus: string;
  createsLocalOverride: boolean;
}

export interface BuildMatchDetailsInput {
  homeTeamId: string;
  awayTeamId: string;
  divisionId: string;
  existingScheduledAt?: string | null;
  date: string;
  time: string;
  venue: string;
  pitch: string;
  round: string;
  duration: string;
  arrival: string;
  notes: string;
}

export function buildMatchResultUpdate({
  homeScore,
  awayScore,
  status,
  source,
  manuallyOverriddenAt,
  now = () => new Date(),
}: BuildResultUpdateInput): MatchResultUpdate {
  const home = homeScore === "" ? null : Number(homeScore);
  const away = awayScore === "" ? null : Number(awayScore);
  const bothScores = home != null && away != null;
  let nextStatus = status;

  if (bothScores && (status === "scheduled" || status === "in_progress")) {
    nextStatus = "completed";
  } else if (!bothScores && status === "completed") {
    nextStatus = "scheduled";
  }

  const createsLocalOverride = Boolean(
    source && source !== "manual" && !manuallyOverriddenAt,
  );
  const payload: Record<string, unknown> = {
    home_score: home,
    away_score: away,
    status: nextStatus,
  };
  if (createsLocalOverride) {
    payload.manually_overridden_at = now().toISOString();
  }

  return { payload, nextStatus, createsLocalOverride };
}

export function buildMatchDetailsPayload({
  homeTeamId,
  awayTeamId,
  divisionId,
  existingScheduledAt,
  date,
  time,
  venue,
  pitch,
  round,
  duration,
  arrival,
  notes,
}: BuildMatchDetailsInput): Record<string, unknown> {
  let scheduledAt = existingScheduledAt ?? null;
  if (date) {
    scheduledAt = new Date(`${date}T${time || "09:00"}:00`).toISOString();
  }

  return {
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    division_id: divisionId || null,
    scheduled_at: scheduledAt,
    venue,
    pitch_number: pitch.trim() || null,
    round_number: round ? Number(round) : null,
    duration_minutes: duration ? Number(duration) : null,
    arrival_minutes_before: arrival ? Number(arrival) : null,
    notes: notes || null,
  };
}

export async function updateCompetitionMatch(
  matchId: string,
  payload: Record<string, unknown>,
  expectedRevision: number | bigint = 0,
): Promise<MatchMutationResult> {
  return withFeatureBackend("competitions", {
    supabase: async () => {
      const { home_score, away_score, ...metadata } = payload;
      if ("home_score" in payload || "away_score" in payload) {
        // Result and status must commit together; never issue a second metadata write.
        const { error } = await supabase.rpc("save_competition_match_result", {
          p_match_id: matchId,
          p_home_score: (home_score ?? null) as number | null,
          p_away_score: (away_score ?? null) as number | null,
          p_status: (payload.status ?? null) as string | null,
        });
        return { error };
      }
      if (!Object.keys(metadata).length) return { error: null };
      const { error } = await supabase.from("competition_matches").update(metadata as never).eq("id", matchId);
      return { error };
    },
    icp: async (ctx) => {
      // The canister result method requires both scores. Never route a partial
      // or cleared result payload into update_match_details, whose shape has
      // no score fields and could otherwise overwrite fixture metadata.
      const homeScore = payload.home_score;
      const awayScore = payload.away_score;
      const hasScoreUpdate = "home_score" in payload || "away_score" in payload;
      if (hasScoreUpdate && (typeof homeScore !== "number" || typeof awayScore !== "number")) {
        return { error: { message: "Both scores are required to update a result on ICP." } };
      }
      if (typeof homeScore === "number" && typeof awayScore === "number") {
        try {
          await setLiveMatchResult(ctx, matchId, homeScore, awayScore, Date.now());
          return { error: null };
        } catch (e) {
          return { error: { message: e instanceof Error ? e.message : String(e) } };
        }
      }
      // Non-score detail edits (teams, schedule, venue, division, notes) go
      // to update_match_details, guarded by the caller-supplied revision
      // (defaults to 0 when the caller has no known revision yet).
      try {
        await updateLiveMatchDetails(ctx, matchId, {
          homeTeamId: String(payload.home_team_id ?? ""),
          awayTeamId: String(payload.away_team_id ?? ""),
          divisionId: (payload.division_id as string | null) ?? null,
          scheduledAtMs: payload.scheduled_at ? new Date(payload.scheduled_at as string).getTime() : null,
          venue: (payload.venue as string | null) ?? null,
          pitchNumber: (payload.pitch_number as string | null) ?? null,
          roundNumber: typeof payload.round_number === "number" ? payload.round_number : null,
          durationMinutes: typeof payload.duration_minutes === "number" ? payload.duration_minutes : null,
          arrivalMinutesBefore: typeof payload.arrival_minutes_before === "number" ? payload.arrival_minutes_before : null,
          notes: (payload.notes as string | null) ?? null,
          expectedRevision: Number(expectedRevision),
        });
        return { error: null };
      } catch (e) {
        return { error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  }, writeOnce({ competitionMatchId: matchId }));
}

/**
 * Persist a generated fixture batch. Supabase inserts all rows atomically;
 * the ICP branch records each match on the competitions canister —
 * provisional: only competition/home/away team ids have a canister shape, so
 * schedule/venue fields are not persisted there, and there is no batch shape
 * so the calls run sequentially.
 */
export async function createGeneratedMatches(
  rows: Array<Record<string, unknown>>,
): Promise<MatchMutationResult> {
  return withFeatureBackend("competitions", {
    supabase: async () => {
      const { error } = await supabase
        .from("competition_matches")
        .insert(rows as never);
      return { error };
    },
    icp: async (ctx) => {
      try {
        for (const row of rows) {
          const match = await recordLiveMatch(
            ctx,
            String(row.competition_id),
            String(row.home_team_id),
            String(row.away_team_id),
          );
          await updateLiveMatchDetails(ctx, match.id, {
            homeTeamId: String(row.home_team_id),
            awayTeamId: String(row.away_team_id),
            divisionId: (row.division_id as string | null | undefined) ?? null,
            scheduledAtMs: row.scheduled_at ? new Date(row.scheduled_at as string).getTime() : null,
            venue: (row.venue as string | null | undefined) ?? null,
            pitchNumber: (row.pitch_number as string | null | undefined) ?? null,
            roundNumber: typeof row.round_number === "number" ? row.round_number : null,
            durationMinutes: typeof row.duration_minutes === "number" ? row.duration_minutes : null,
            arrivalMinutesBefore: typeof row.arrival_minutes_before === "number" ? row.arrival_minutes_before : null,
            notes: (row.notes as string | null | undefined) ?? null,
            expectedRevision: Number(match.revision),
          });
        }
        return { error: null };
      } catch (e) {
        return { error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  }, writeOnce({ competitionId: String(rows[0]?.competition_id ?? "") }));
}

export async function deleteCompetitionMatch(
  matchId: string,
): Promise<MatchMutationResult> {
  return withFeatureBackend("competitions", {
    supabase: async () => {
      const { error } = await supabase
        .from("competition_matches")
        .delete()
        .eq("id", matchId);
      return { error };
    },
    icp: async (ctx) => {
      try {
        await deleteLiveMatch(ctx, matchId);
        return { error: null };
      } catch (e) {
        return { error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  }, writeOnce({ competitionMatchId: matchId }));
}

export async function trimCompetitionRounds(
  competitionId: string,
  maximumRound: number,
): Promise<MatchMutationResult> {
  return withFeatureBackend("competitions", {
    supabase: async () => {
      const { error } = await supabase
        .from("competition_matches")
        .delete()
        .eq("competition_id", competitionId)
        .gt("round_number", maximumRound);
      return { error };
    },
    icp: async (ctx) => {
      try {
        await trimLiveCompetitionRounds(ctx, competitionId, maximumRound);
        return { error: null };
      } catch (e) {
        return { error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  }, writeOnce({ competitionId }));
}
