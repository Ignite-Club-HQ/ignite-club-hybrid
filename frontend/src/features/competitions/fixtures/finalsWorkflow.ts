import { supabase } from "@/integrations/supabase/client";
import { buildFinalsSeedPairings, type FinalsFormat } from "@/lib/competitionScheduler";

export interface FinalsRoundInput {
  competitionId: string;
  divisionId: string;
  roundNumber: number;
  format: FinalsFormat;
  date: string;
  time: string;
  duration: string;
  venue: string;
  pitchInput: string;
  createdBy?: string | null;
}

export interface FinalsFixtureRow {
  competition_id: string;
  division_id: string | null;
  round_number: number;
  home_team_id: null;
  away_team_id: null;
  status: "scheduled";
  created_by: string | null;
  scheduled_at: string;
  venue: string;
  pitch_number: string;
  duration_minutes: number;
  notes: string;
}

export async function discoverNextFinalsRound(
  competitionId: string,
  divisionId: string,
): Promise<
  | { nextRound: number; error: null }
  | { nextRound: null; error: { message: string } }
> {
  let query = supabase
    .from("competition_matches")
    .select("round_number")
    .eq("competition_id", competitionId)
    .order("round_number", { ascending: false, nullsFirst: false })
    .limit(1);
  query = divisionId
    ? query.eq("division_id", divisionId)
    : query.is("division_id", null);

  const { data, error } = await query;
  if (error) return { nextRound: null, error };
  return { nextRound: (data?.[0]?.round_number ?? 0) + 1, error: null };
}

export function buildFinalsFixtureRows({
  competitionId,
  divisionId,
  roundNumber,
  format,
  date,
  time,
  duration,
  venue,
  pitchInput,
  createdBy,
}: FinalsRoundInput): FinalsFixtureRow[] {
  const pairs = buildFinalsSeedPairings(format);
  const pitchLabels = pitchInput
    .split(/[,\n]/)
    .map((label) => label.trim())
    .filter(Boolean);
  const pitches = pitchLabels.length > 0
    ? pitchLabels
    : Array.from({ length: pairs.length }, (_, index) => String(index + 1));
  const durationMinutes = Math.max(1, Number(duration) || 60);
  const [hours, minutes] = time.split(":").map(Number);
  const baseStart = new Date(`${date}T00:00:00`);
  baseStart.setHours(hours || 9, minutes || 0, 0, 0);

  return pairs.map((pairing, index) => {
    const wave = Math.floor(index / pitches.length);
    const start = new Date(baseStart.getTime() + wave * durationMinutes * 60_000);
    return {
      competition_id: competitionId,
      division_id: divisionId || null,
      round_number: roundNumber,
      home_team_id: null,
      away_team_id: null,
      status: "scheduled",
      created_by: createdBy ?? null,
      scheduled_at: start.toISOString(),
      venue,
      pitch_number: pitches[index % pitches.length],
      duration_minutes: durationMinutes,
      notes: pairing.isGrandFinal
        ? `Grand Final · ${pairing.homeSeed} v ${pairing.awaySeed}`
        : `Finals · ${pairing.homeSeed} v ${pairing.awaySeed}`,
    };
  });
}

export async function createFinalsFixtures(rows: FinalsFixtureRow[]) {
  const { error } = await supabase
    .from("competition_matches")
    .insert(rows as never);
  return { error };
}
