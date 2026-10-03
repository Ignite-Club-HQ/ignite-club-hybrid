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
  adminsOnly: boolean,
  expectedRevision: number,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_chat_settings(competitionId, chatEnabled, adminsOnly, BigInt(expectedRevision)),
    "Set chat settings",
  );
}

/**
 * Entry-invite flow: the competition manager invites a team, an admin of
 * that team accepts or declines. Mirrors the Supabase competition_entries
 * status transitions read by TeamCompetitionsSection.
 */
export async function inviteLiveTeamToCompetition(
  ctx: FeatureBackendContext,
  competitionId: string,
  teamId: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.invite_team(competitionId, teamId), "Invite team to competition");
}

export async function respondLiveEntryInvite(
  ctx: FeatureBackendContext,
  competitionId: string,
  teamId: string,
  accept: boolean,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.respond_to_entry_invite(competitionId, teamId, accept),
    "Respond to entry invite",
  );
}

export async function listLiveEntriesByTeam(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_entries_by_team(teamId), "List entries by team");
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

export async function listLiveCompetitionJoinLinks(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_competition_join_links(competitionId),
    "List competition join links",
  );
}

export async function joinLiveCompetitionByToken(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.join_competition_by_token(token), "Join competition");
}

/**
 * Public join-link preview (comp info, season divisions, entered team ids).
 * The canister allows anonymous callers, so callers may pass an
 * AnonymousIdentity ctx when nobody is signed in yet (the join page reads
 * this pre-auth, mirroring the Supabase SECURITY DEFINER join-token RPCs).
 * Status hints "unknown" | "disabled" | "archived" come back as
 * { status, preview: null } rather than throwing.
 */
export async function getLiveJoinLinkPreview(
  ctx: FeatureBackendContext,
  token: string,
): Promise<
  | { status: "ok"; preview: { competition_id: string; name: string; club_id: string; season: string; competition_status: string; divisions: string[]; entered_team_ids: string[] } }
  | { status: string; preview: null }
> {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  const result = await actor.get_join_link_preview(token);
  if ("Err" in result) return { status: result.Err, preview: null };
  return { status: "ok", preview: result.Ok };
}

/**
 * Team-admin self-entry via a competition join link: validates the token
 * canister-side and registers the team (optional division) — unlike
 * registerLiveCompetitionTeam this needs no competition-management rights.
 */
export async function joinLiveCompetitionWithLink(
  ctx: FeatureBackendContext,
  token: string,
  teamId: string,
  divisionId: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.join_competition_with_link(token, teamId, candidOpt(divisionId)),
    "Join competition",
  );
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

/**
 * EOI (expression-of-interest) submissions — competition_domain's
 * eoiSubmissions entity, counterpart of the Supabase eoi_submissions table
 * and its RPCs. Resend/bulk-resend email delivery stays on Supabase; only
 * the bookkeeping (invite_sent_at/count) lives here.
 */

export async function listLiveEoiSubmissions(
  ctx: FeatureBackendContext,
  clubId: string,
  seasonId?: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_eoi_submissions(clubId, candidOpt(seasonId)),
    "List EOI submissions",
  );
}

export async function getLiveEoiStats(
  ctx: FeatureBackendContext,
  clubId: string,
  seasonId?: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_eoi_stats(clubId, candidOpt(seasonId)), "Get EOI stats");
}

export async function getLiveMyPendingEois(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_my_pending_eois(), "Get my pending EOIs");
}

export async function suggestLiveEoiTeams(ctx: FeatureBackendContext, seasonId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.suggest_eoi_teams(seasonId), "Suggest EOI teams");
}

export async function confirmLiveEoiPlacement(ctx: FeatureBackendContext, submissionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.confirm_eoi_placement(submissionId), "Confirm EOI placement");
}

export async function claimLiveEoiByToken(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.claim_eoi_by_token(token), "Claim EOI submission");
}

export interface LiveEoiSubmissionUpdate {
  extraNotes?: string | null;
  preferredTeammates?: string | null;
  preferredPosition?: string | null;
}

export async function updateLiveEoiSubmission(
  ctx: FeatureBackendContext,
  id: string,
  patch: LiveEoiSubmissionUpdate,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_eoi_submission(
      id,
      candidOpt(patch.extraNotes),
      candidOpt(patch.preferredTeammates),
      candidOpt(patch.preferredPosition),
    ),
    "Update EOI submission",
  );
}

export async function updateLiveEoiStatus(ctx: FeatureBackendContext, id: string, status: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.update_eoi_status(id, status), "Update EOI status");
}

export async function assignLiveEoiTeam(
  ctx: FeatureBackendContext,
  id: string,
  teamId: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.assign_eoi_team(id, candidOpt(teamId)), "Assign EOI team");
}

export async function deleteLiveEoi(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_eoi(id), "Delete EOI submission");
}

export async function allocateLiveEoiToTeam(
  ctx: FeatureBackendContext,
  id: string,
  teamId: string | null,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.allocate_eoi_to_team(id, candidOpt(teamId)), "Allocate EOI to team");
}

/** Bookkeeping half of the resend flow — marks invite_sent_at/count; email delivery stays on Supabase. */
export async function resendLiveEoiInvite(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.resend_eoi_invite(id), "Resend EOI invite");
}

export async function bulkResendLiveEoiInvites(ctx: FeatureBackendContext, ids: string[]) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.bulk_resend_eoi_invites(ids), "Bulk resend EOI invites");
}

/** Per-competition engagement rollup (active teams, matches, results, broadcasts-excluded). */
export async function getLiveCompetitionEngagementSummary(
  ctx: FeatureBackendContext,
  competitionIds: string[],
  sinceMs: number | Date,
  untilMs: number | Date,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.competition_engagement_summary(
      competitionIds,
      BigInt(sinceMs instanceof Date ? sinceMs.getTime() : sinceMs),
      BigInt(untilMs instanceof Date ? untilMs.getTime() : untilMs),
    ),
    "Get competition engagement summary",
  );
}

/**
 * Maps the canister EoiSubmission (opt nat64 ms timestamps, opt principal)
 * into the Supabase eoi_submissions row shape the hooks/UI already expect.
 */
export function mapLiveEoiSubmission(s: any) {
  const ms = (v: [] | [bigint]): string | null => (v.length === 0 ? null : new Date(Number(v[0])).toISOString());
  const opt = (v: [] | [string]): string | null => (v.length === 0 ? null : v[0]);
  const optNum = (v: [] | [number]): number | null => (v.length === 0 ? null : v[0]);
  return {
    age_group: opt(s.age_group),
    allocated_at: ms(s.allocated_at_ms),
    assigned_team_id: opt(s.assigned_team_id),
    child_id: opt(s.child_id),
    claim_token: s.claim_token,
    claimed_at: ms(s.claimed_at_ms),
    club_id: s.club_id,
    confirmed_at: ms(s.confirmed_at_ms),
    created_at: new Date(Number(s.created_at_ms)).toISOString(),
    extra_notes: opt(s.extra_notes),
    game_days: s.game_days,
    id: s.id,
    invite_sent_at: ms(s.invite_sent_at_ms),
    invite_sent_count: s.invite_sent_count,
    notes: opt(s.notes),
    parent_confirmed_at: ms(s.parent_confirmed_at_ms),
    parent_email: s.parent_email,
    parent_mobile: opt(s.parent_mobile),
    parent_name: s.parent_name,
    parent_user_id: s.parent_user_id.length === 0 ? null : s.parent_user_id[0].toText(),
    player_dob: opt(s.player_dob),
    player_gender: opt(s.player_gender),
    player_name: s.player_name,
    preferred_position: opt(s.preferred_position),
    preferred_teammates: opt(s.preferred_teammates),
    registered_at: ms(s.registered_at_ms),
    returning_player: s.returning_player,
    season_id: s.season_id,
    skill_level: optNum(s.skill_level),
    source: s.source,
    status: s.status,
    submitted_at: new Date(Number(s.submitted_at_ms)).toISOString(),
    training_days: s.training_days,
    updated_at: new Date(Number(s.updated_at_ms)).toISOString(),
    withdrawn_at: ms(s.withdrawn_at_ms),
  };
}
