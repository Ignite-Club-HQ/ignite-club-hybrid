import { connectLiveCompetitionDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { toNat64, unwrapCandid } from "./candid";

/**
 * Competitions feature -> competition_domain canister.
 *
 * NOTE: untested against a live canister until deployment.
 */

export async function createLiveCompetition(
  ctx: FeatureBackendContext,
  clubId: string,
  name: string,
  seasonId: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_competition(clubId, name, seasonId),
    "Create competition",
  );
}

export async function createLiveSeason(
  ctx: FeatureBackendContext,
  competitionId: string,
  name: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.create_season(competitionId, name), "Create season");
}

export async function setLiveSeasonStatus(
  ctx: FeatureBackendContext,
  seasonId: string,
  status: string,
  expectedRevision: number,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_season_status(seasonId, status, BigInt(expectedRevision)),
    "Set season status",
  );
}

export async function registerLiveCompetitionTeam(
  ctx: FeatureBackendContext,
  competitionId: string,
  teamId: string,
  clubId: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.register_team(competitionId, teamId, clubId),
    "Register team",
  );
}

export async function recordLiveMatch(
  ctx: FeatureBackendContext,
  competitionId: string,
  homeTeamId: string,
  awayTeamId: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.record_match(competitionId, homeTeamId, awayTeamId),
    "Record match",
  );
}

export async function setLiveMatchResult(
  ctx: FeatureBackendContext,
  matchId: string,
  homeScore: number,
  awayScore: number,
  recordedAtMs: number | Date,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_match_result(matchId, homeScore, awayScore, toNat64(recordedAtMs)),
    "Set match result",
  );
}

export async function issueLiveJoinToken(
  ctx: FeatureBackendContext,
  competitionId: string,
  teamId: string,
  expiresAtMs: number | Date,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.issue_join_token(competitionId, teamId, toNat64(expiresAtMs)),
    "Issue join token",
  );
}

export async function listLiveCompetitions(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_competitions(clubId), "List competitions");
}

export async function listLiveCompetitionEntries(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_entries(competitionId), "List competition entries");
}

export async function listLiveCompetitionSeasons(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_seasons(competitionId), "List competition seasons");
}

export async function listLiveCompetitionMatches(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_matches(competitionId), "List competition matches");
}

export async function claimLiveJoinToken(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.claim_join_token(token), "Claim join token");
}

export interface LiveMatchDetailsInput {
  homeTeamId: string;
  awayTeamId: string;
  divisionId?: string | null;
  scheduledAtMs?: number | Date | null;
  venue?: string | null;
  pitchNumber?: string | null;
  roundNumber?: number | null;
  durationMinutes?: number | null;
  arrivalMinutesBefore?: number | null;
  notes?: string | null;
  expectedRevision: number;
}

/**
 * Fixture detail edit (teams, schedule, venue, division, notes) — the
 * counterpart of the edit-match dialog's Supabase update. Scores stay under
 * set_match_result.
 */
export async function updateLiveMatchDetails(
  ctx: FeatureBackendContext,
  matchId: string,
  input: LiveMatchDetailsInput,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_match_details(
      matchId,
      input.homeTeamId,
      input.awayTeamId,
      candidOpt(input.divisionId),
      candidOpt(input.scheduledAtMs == null ? null : toNat64(input.scheduledAtMs)),
      candidOpt(input.venue),
      candidOpt(input.pitchNumber),
      candidOpt(input.roundNumber),
      candidOpt(input.durationMinutes),
      candidOpt(input.arrivalMinutesBefore),
      candidOpt(input.notes),
      BigInt(input.expectedRevision),
    ),
    "Update match details",
  );
}

export async function assignLiveDivision(
  ctx: FeatureBackendContext,
  competitionId: string,
  teamId: string,
  divisionId: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.assign_division(competitionId, teamId, candidOpt(divisionId)),
    "Assign division",
  );
}

/** Counterpart of the Supabase duplicate_season_structure RPC. */
export async function duplicateLiveSeason(
  ctx: FeatureBackendContext,
  competitionId: string,
  sourceName: string,
  newName: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.duplicate_season(competitionId, sourceName, newName),
    "Duplicate season",
  );
}

export async function setLiveSeasonDivisions(
  ctx: FeatureBackendContext,
  competitionId: string,
  seasonName: string,
  divisions: string[],
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_season_divisions(competitionId, seasonName, divisions),
    "Set season divisions",
  );
}

/** Cross-club listing for the competitions overview when no club is selected. */
export async function listLiveCompetitionsMulti(
  ctx: FeatureBackendContext,
  clubIds: string[],
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_competitions_multi(clubIds), "List competitions");
}
