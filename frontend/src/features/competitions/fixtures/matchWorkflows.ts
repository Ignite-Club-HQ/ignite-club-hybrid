import { supabase } from "@/integrations/supabase/client";

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
): Promise<MatchMutationResult> {
  const { error } = await supabase
    .from("competition_matches")
    .update(payload as never)
    .eq("id", matchId);
  return { error };
}

export async function deleteCompetitionMatch(
  matchId: string,
): Promise<MatchMutationResult> {
  const { error } = await supabase
    .from("competition_matches")
    .delete()
    .eq("id", matchId);
  return { error };
}

export async function trimCompetitionRounds(
  competitionId: string,
  maximumRound: number,
): Promise<MatchMutationResult> {
  const { error } = await supabase
    .from("competition_matches")
    .delete()
    .eq("competition_id", competitionId)
    .gt("round_number", maximumRound);
  return { error };
}
