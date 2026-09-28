import type { PlacedFixture } from "@/lib/competitionScheduler";

export interface GeneratedFixtureRow {
  competition_id: string;
  division_id: string | null;
  round_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  status: "scheduled";
  created_by: string | null;
  scheduled_at: string | null;
  venue: string;
  pitch_number: string | null;
  duration_minutes: number | null;
  arrival_minutes_before: number | null;
  notes: string | null;
}

export interface BuildGeneratedFixturesInput {
  competitionId: string;
  divisionId: string;
  startRound: string;
  createdBy?: string | null;
  venue: string;
  durationMinutes: number;
  arrivalMinutesBefore: string;
  placedFixtures: PlacedFixture[];
}

export interface FixturePersistenceError {
  message?: string | null;
}

export type InsertGeneratedFixtures = (
  rows: GeneratedFixtureRow[],
) => Promise<{ error: FixturePersistenceError | null }>;

const GENERIC_SAVE_ERROR =
  "Something went wrong while saving these fixtures. Please try again in a moment.";

export function buildGeneratedFixtureRows({
  competitionId,
  divisionId,
  startRound,
  createdBy,
  venue,
  durationMinutes,
  arrivalMinutesBefore,
  placedFixtures,
}: BuildGeneratedFixturesInput): GeneratedFixtureRow[] {
  const arrival = arrivalMinutesBefore ? Number(arrivalMinutesBefore) : null;
  const startRoundOffset = Math.max(1, Number(startRound) || 1) - 1;

  return placedFixtures.map((fixture) => ({
    competition_id: competitionId,
    division_id: divisionId || null,
    round_number: startRoundOffset + fixture.round,
    home_team_id: fixture.home,
    away_team_id: fixture.away,
    status: "scheduled",
    created_by: createdBy ?? null,
    scheduled_at: fixture.scheduledAt ? fixture.scheduledAt.toISOString() : null,
    venue,
    pitch_number: fixture.pitch,
    duration_minutes: durationMinutes || null,
    arrival_minutes_before: arrival,
    notes: fixture.note ?? null,
  }));
}

export function describeGeneratedFixtureSaveError(
  error: FixturePersistenceError,
): string {
  const raw = (error.message || "").toLowerCase();
  if (raw.includes("duplicate") || raw.includes("unique")) {
    return "Some of these fixtures already exist for this competition. Try regenerating or shuffling first.";
  }
  if (
    raw.includes("permission") ||
    raw.includes("row-level") ||
    raw.includes("not authorized")
  ) {
    return "You don't have permission to save fixtures for this competition.";
  }
  if (raw.includes("network") || raw.includes("fetch")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return GENERIC_SAVE_ERROR;
}

export function persistGeneratedFixtures(
  rows: GeneratedFixtureRow[],
  insertFixtures: InsertGeneratedFixtures,
): Promise<{ error: FixturePersistenceError | null }> {
  return insertFixtures(rows);
}
