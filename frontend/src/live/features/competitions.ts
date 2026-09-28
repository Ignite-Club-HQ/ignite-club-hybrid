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

export async function claimLiveJoinToken(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.claim_join_token(token), "Claim join token");
}
