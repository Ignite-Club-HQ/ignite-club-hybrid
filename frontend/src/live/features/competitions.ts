import { connectLiveCompetitionDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, toNat64, unwrapCandid } from "./candid";

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

/** ICP counterpart of the Supabase `is_competition_admin` RPC. */
export async function isLiveCompetitionAdmin(
  ctx: FeatureBackendContext,
  competitionId: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.is_competition_admin(competitionId),
    "Check competition admin",
  );
}

/**
 * Competition roles — per-competition RBAC grants (add/remove/list),
 * counterpart of the club_domain `*_team_captain`/ACL style wrappers above.
 */
export async function addLiveCompetitionRole(
  ctx: FeatureBackendContext,
  competitionId: string,
  principal: Parameters<Awaited<ReturnType<typeof connectLiveCompetitionDomain>>["actor"]["add_competition_role"]>[1],
  role: string,
  teamId?: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_competition_role(competitionId, principal, role, candidOpt(teamId)),
    "Add competition role",
  );
}

export async function removeLiveCompetitionRole(
  ctx: FeatureBackendContext,
  competitionId: string,
  principal: Parameters<Awaited<ReturnType<typeof connectLiveCompetitionDomain>>["actor"]["remove_competition_role"]>[1],
  role: string,
  teamId?: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.remove_competition_role(competitionId, principal, role, candidOpt(teamId)),
    "Remove competition role",
  );
}

export async function listLiveCompetitionRoles(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_competition_roles(competitionId), "List competition roles");
}

/**
 * Competition chat settings (enable/disable chat for a competition).
 */
export async function getLiveCompetitionChatSettings(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_chat_settings(competitionId), "Get chat settings");
}

export async function setLiveCompetitionChatSettings(
  ctx: FeatureBackendContext,
  competitionId: string,
  chatEnabled: boolean,
  expectedRevision: number,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_chat_settings(competitionId, chatEnabled, BigInt(expectedRevision)),
    "Set chat settings",
  );
}

/**
 * Competition invites — single-use invites targeted at a specific
 * principal, distinct from the shareable join links below.
 */
export async function createLiveCompetitionInvite(
  ctx: FeatureBackendContext,
  competitionId: string,
  invitee: Parameters<Awaited<ReturnType<typeof connectLiveCompetitionDomain>>["actor"]["create_competition_invite"]>[1],
  role: string,
  teamId?: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_competition_invite(competitionId, invitee, role, candidOpt(teamId)),
    "Create competition invite",
  );
}

export async function acceptLiveCompetitionInvite(ctx: FeatureBackendContext, inviteId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.accept_competition_invite(inviteId), "Accept competition invite");
}

export async function declineLiveCompetitionInvite(ctx: FeatureBackendContext, inviteId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.decline_competition_invite(inviteId), "Decline competition invite");
}

export async function listLiveCompetitionInvites(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_competition_invites(competitionId), "List competition invites");
}

export async function listLiveCompetitionInvitesByInvitee(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_invites_by_invitee(), "List competition invites");
}

/**
 * Competition join links — shareable rotating-token links, counterpart of
 * the club_domain team invite links above.
 */
export async function createLiveCompetitionJoinLink(
  ctx: FeatureBackendContext,
  competitionId: string,
  role: string,
  teamId?: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_competition_join_link(competitionId, role, candidOpt(teamId)),
    "Create competition join link",
  );
}

export async function rotateLiveCompetitionJoinLink(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.rotate_competition_join_link(competitionId), "Rotate competition join link");
}

export async function revokeLiveCompetitionJoinLink(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_competition_join_link(competitionId), "Revoke competition join link");
}

export async function joinLiveCompetitionByToken(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.join_competition_by_token(token), "Join competition");
}

/** Removes a recorded match (distinct from editing its details). */
export async function deleteLiveMatch(ctx: FeatureBackendContext, matchId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_match(matchId), "Delete match");
}

/** Drops rounds above `maxRound` — counterpart of the Supabase round-trim admin action. */
export async function trimLiveCompetitionRounds(
  ctx: FeatureBackendContext,
  competitionId: string,
  maxRound: number,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.trim_rounds(competitionId, maxRound), "Trim rounds");
}
