import { supabase } from "@/integrations/supabase/client";

export interface ManualMatchInput {
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  divisionId: string;
  scheduledAt: string;
  venue: string;
  pitch: string;
  round: string;
  duration: string;
  arrival: string;
  notes: string;
  createdBy?: string | null;
}

export interface ManualMatchRow {
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  division_id: string | null;
  scheduled_at: string;
  venue: string;
  pitch_number: string | null;
  round_number: number | null;
  duration_minutes: number | null;
  arrival_minutes_before: number | null;
  notes: string | null;
  status: "scheduled";
  created_by: string | null;
}

export function buildManualMatchRow({
  competitionId,
  homeTeamId,
  awayTeamId,
  divisionId,
  scheduledAt,
  venue,
  pitch,
  round,
  duration,
  arrival,
  notes,
  createdBy,
}: ManualMatchInput): ManualMatchRow {
  return {
    competition_id: competitionId,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    division_id: divisionId || null,
    scheduled_at: new Date(scheduledAt).toISOString(),
    venue,
    pitch_number: pitch.trim() || null,
    round_number: round ? Number(round) : null,
    duration_minutes: duration ? Number(duration) : null,
    arrival_minutes_before: arrival ? Number(arrival) : null,
    notes: notes || null,
    status: "scheduled",
    created_by: createdBy ?? null,
  };
}

export async function createManualMatch(row: ManualMatchRow) {
  const { error } = await supabase
    .from("competition_matches")
    .insert(row as never);
  return { error };
}
