/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Candid/Supabase payloads at this boundary */
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

export async function createLiveCompetitionEvent(
  ctx: FeatureBackendContext,
  input: {
    operationId: string;
    competitionId: string;
    title: string;
    description: string;
    eventType: string;
    location?: string | null;
    startsAtMs: number | Date;
    endsAtMs: number | Date;
  },
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_competition_event(
      input.operationId,
      input.competitionId,
      input.title,
      input.description,
      input.eventType,
      candidOpt(input.location),
      toNat64(input.startsAtMs),
      toNat64(input.endsAtMs),
    ),
    "Create event for competition teams",
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

/** Each destination verifies live membership before returning participant cards. */
export async function listLiveCompetitionCards(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  const cards = await unwrapCandid(actor.read_my_competition_cards(), "Read my competitions");
  return cards.map(({ competition: c, entries }) => ({
    id: c.id, name: c.name, sport: null, season: c.season, status: c.status,
    visibility: c.visibility, starts_on: null, ends_on: null,
    organizer_club_id: c.club_id, source: null, last_synced_at: null, clubs: null,
    competition_entries: entries.map(e => ({
      id: `${e.competition_id}:${e.team_id}`, team_id: e.team_id, status: e.status,
      competition_id: e.competition_id, teams: { club_id: e.club_id, deleted_at: null },
    })),
  }));
}

export async function updateLiveCompetitionSettings(
  ctx: FeatureBackendContext,
  competitionId: string,
  settings: {
    name: string;
    description: string | null;
    status: string;
    visibility: string;
    pointsWin: number;
    pointsDraw: number;
    pointsLoss: number;
  },
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_competition_settings(
      competitionId,
      settings.name,
      candidOpt(settings.description),
      settings.status,
      settings.visibility,
      settings.pointsWin,
      settings.pointsDraw,
      settings.pointsLoss,
    ),
    "Save competition settings",
  );
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

export async function readLiveCompetitionPlayHQ(ctx:FeatureBackendContext,competitionId:string){
 const {actor}=await connectLiveCompetitionDomain(ctx.target,ctx.identity);
 const raw=await unwrapCandid(actor.read_playhq_stats(competitionId),"Read PlayHQ statistics");
 return {matches:raw.matches.map(m=>({tenant:m.tenant,external_id:m.game_id,external_home_team_id:m.home_id,external_away_team_id:m.away_id,home_team_name:m.home_name,away_team_name:m.away_name,division_id:m.grade_id,competition_divisions:{name:m.grade_id}})),
 stats:raw.stats.map(s=>({playhq_game_id:s.game_id,playhq_team_id:s.team_id,playhq_player_id:s.player_id,player_name:s.player_name,stats:JSON.parse(s.stats_json) as Record<string,number>,tenant:s.tenant})),
 links:raw.claims.map(c=>({playhq_player_id:c.player_id,mine:c.mine,tenant:c.tenant}))};
}
export async function claimLiveCompetitionPlayHQ(ctx:FeatureBackendContext,competitionId:string,tenant:string,playerId:string){
 const {actor}=await connectLiveCompetitionDomain(ctx.target,ctx.identity);
 return unwrapCandid(actor.claim_playhq_player(competitionId,tenant,playerId),"Claim PlayHQ player");
}
export async function syncLiveCompetitionPlayHQ(ctx:FeatureBackendContext,competitionId:string,tenant:string,grade:string){
 const {actor}=await connectLiveCompetitionDomain(ctx.target,ctx.identity);
 return unwrapCandid(actor.sync_playhq_grade(competitionId,tenant,grade),"Sync PlayHQ grade");
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

export async function createLiveFixture(ctx: FeatureBackendContext, operation: string, competitionId: string, input: Omit<LiveMatchDetailsInput, "expectedRevision">) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  const match = await unwrapCandid(actor.create_fixture(operation, {
    competition_id: competitionId, home_team: input.homeTeamId, away_team: input.awayTeamId,
    division_id: candidOpt(input.divisionId), scheduled_at_ms: candidOpt(input.scheduledAtMs == null ? null : toNat64(input.scheduledAtMs)),
    venue: candidOpt(input.venue), pitch_number: candidOpt(input.pitchNumber), round_number: candidOpt(input.roundNumber),
    duration_minutes: candidOpt(input.durationMinutes), arrival_minutes_before: candidOpt(input.arrivalMinutesBefore), notes: candidOpt(input.notes),
  }), "Create fixture");
  if (match.scheduled_at_ms.length) await unwrapCandid(actor.materialize_match_events(match.id), "Synchronize existing fixture events");
  return match;
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
  const result = await unwrapCandid(
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
  if(input.scheduledAtMs!=null) await unwrapCandid(actor.materialize_match_events(matchId),"Sync fixture events");
  return result;
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

export async function moveLiveTeamDivision(ctx: FeatureBackendContext, competitionId: string, teamId: string,
  expectedDivision: string | null, divisionId: string | null, clearFixtures: boolean) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return Number(await unwrapCandid(actor.move_team_division(competitionId, teamId, candidOpt(expectedDivision), candidOpt(divisionId), clearFixtures), "Move team division"));
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

export async function listLivePublicCompetitions(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_public_competitions(), "List public competitions");
}

export async function listLiveMyNewsCompetitions(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_my_news_competitions(), "List publishable competitions");
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

export async function getLiveCompetitionWelcomeEmail(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_competition_welcome_email(competitionId), "Get competition welcome settings");
}

export async function setLiveCompetitionWelcomeEmail(
  ctx: FeatureBackendContext,
  competitionId: string,
  settings: { enabled: boolean; subject: string; message: string },
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_competition_welcome_email(competitionId, settings.enabled, settings.subject, settings.message),
    "Save competition welcome settings",
  );
}

/**
 * Registers a pending welcome email for an official email invite. The
 * canister only accepts it while the competition's welcome settings are
 * enabled and the invite is still pending; the recipient address is stored
 * on-chain so delivery never trusts the browser for it.
 */
export async function registerLiveCompetitionWelcomeJob(
  ctx: FeatureBackendContext,
  token: string,
  to: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.register_competition_welcome_job(token, to), "Register competition welcome email");
}

/**
 * Registers a pending welcome email for an existing member (e.g. after
 * their team accepts a competition entry). ICP accounts carry no email, so
 * the member supplies their own address; the canister verifies their
 * competition membership and keeps one job per member per competition.
 * The token must be a fresh browser-generated unguessable id — it is the
 * capability the delivery edge function reads the job back with.
 */
export async function registerLiveMemberWelcomeJob(
  ctx: FeatureBackendContext,
  competitionId: string,
  token: string,
  to: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.register_member_welcome_job(competitionId, token, to), "Register member welcome email");
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

export async function createLiveCompetitionOfficialLink(
  ctx: FeatureBackendContext,
  competitionId: string,
  role: "referee" | "committee_member",
  token: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_competition_official_link(competitionId, role, token),
    "Create competition official link",
  );
}

export async function revokeLiveCompetitionOfficialLink(
  ctx: FeatureBackendContext,
  competitionId: string,
  role: "referee" | "committee_member",
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.revoke_competition_official_link(competitionId, role),
    "Revoke competition official link",
  );
}

export async function createLiveCompetitionOfficialEmailInvite(
  ctx: FeatureBackendContext,
  competitionId: string,
  role: "referee" | "committee_member",
  token: string,
  emailHash: string,
  verificationCodeHash: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_competition_official_email_invite(competitionId, role, token, emailHash, verificationCodeHash),
    "Create email-bound competition official invite",
  );
}

export async function getLiveCompetitionOfficialEmailInvitePreview(
  ctx: FeatureBackendContext,
  token: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_competition_official_email_invite_preview(token), "Get official invite preview");
}

export async function acceptLiveCompetitionOfficialEmailInvite(
  ctx: FeatureBackendContext,
  token: string,
  emailHash: string,
  verificationCodeHash: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.accept_competition_official_email_invite(token, emailHash, verificationCodeHash),
    "Accept email-bound competition official invite",
  );
}

export async function revokeLiveCompetitionOfficialEmailInvite(
  ctx: FeatureBackendContext,
  token: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_competition_official_email_invite(token), "Revoke official email invite");
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
  | { status: "ok"; preview: { competition_id: string; role: string; name: string; club_id: string; season: string; competition_status: string; divisions: string[]; entered_team_ids: string[] } }
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
 * and its RPCs. Email requests and delivery receipts stay on ICP;
 * only the provider transport is external.
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

export async function syncLiveCompetitionAccess(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.sync_my_competition_access(competitionId), "Check competition access");
}

export async function listLiveDivisionSettings(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_division_settings(competitionId), "List division settings");
}

export async function setLiveDivisionHideLadder(ctx: FeatureBackendContext, competitionId: string, division: string, hide: boolean) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_division_hide_ladder(competitionId, division, hide), "Update ladder visibility");
}

export async function getLiveCompetitionHideLadder(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_competition_hide_ladder(competitionId), "Get competition ladder visibility");
}

export async function setLiveCompetitionHideLadder(ctx: FeatureBackendContext, competitionId: string, hide: boolean) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_competition_hide_ladder(competitionId, hide), "Update competition ladder visibility");
}

export async function sendLiveCompetitionBroadcast(ctx: FeatureBackendContext, competitionId: string, title: string, body: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.send_competition_broadcast(competitionId, title, body), "Send broadcast");
}

export async function listLiveCompetitionBroadcasts(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.read_account_list_competition_broadcasts(competitionId), "List broadcasts");
}

/**
 * Personal (clubless) competitions — counterpart of create_personal_competition
 * on Supabase (organizerClubId === PERSONAL_ORGANISER). Caller becomes the
 * implicit organiser; listing is caller-scoped on the canister.
 */
export async function createLivePersonalCompetition(
  ctx: FeatureBackendContext,
  name: string,
  season: string,
) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_personal_competition(name, season),
    "Create personal competition",
  );
}

export async function listLivePersonalCompetitions(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_my_personal_competitions(), "List my personal competitions");
}

/**
 * Referee / committee officials (competition_domain role links + the
 * competition-chat-scope -> messaging_domain conversation mapping).
 */
export type OfficialRole = "referee" | "committee";
export const OFFICIAL_CHAT_SCOPE: Record<OfficialRole, "referees" | "committee"> = {
  referee: "referees",
  committee: "committee",
};

export async function getLiveRoleLink(ctx: FeatureBackendContext, competitionId: string, role: OfficialRole) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  const opt = await unwrapCandid(actor.get_role_link(competitionId, role), "Get role link");
  return opt[0] ?? null;
}

export async function createLiveRoleLink(ctx: FeatureBackendContext, competitionId: string, role: OfficialRole) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.create_role_link(competitionId, role), "Create role link");
}

export async function revokeLiveRoleLink(ctx: FeatureBackendContext, competitionId: string, role: OfficialRole) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_role_link(competitionId, role), "Turn off role link");
}

/** Anonymous-safe: pass an AnonymousIdentity ctx before sign-in. Null when the link is unknown/off. */
export async function getLiveRoleLinkPreview(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  const result = await actor.get_role_link_preview(token);
  return "Ok" in result ? result.Ok : null;
}

export async function acceptLiveRoleLink(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.accept_role_link(token), "Join as official");
}

export async function listLiveOfficialChats(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_official_chats(competitionId), "List competition chats");
}

/**
 * Brings the referees/committee group chats in line with the current role
 * holders: creates the chat (in the organiser club) once someone holds the
 * role, records it on competition_domain, and adds any missing holders.
 * Runs as a competition manager (the caller becomes the chat owner), so
 * people who joined via a link are added the next time a manager opens
 * settings. Clubless (personal) competitions have no club to host chats.
 */
export async function syncLiveOfficialChats(
  ctx: FeatureBackendContext,
  competitionId: string,
  clubId: string | null,
  competitionName: string,
) {
  if (!clubId) return;
  const [{ Principal }, messaging] = await Promise.all([
    import("@icp-sdk/core/principal"),
    import("./messaging"),
  ]);
  const me = ctx.identity.getPrincipal();
  const [grants, chats] = await Promise.all([
    listLiveCompetitionRoles(ctx, competitionId),
    listLiveOfficialChats(ctx, competitionId),
  ]);
  for (const role of ["referee", "committee"] as OfficialRole[]) {
    const scope = OFFICIAL_CHAT_SCOPE[role];
    const holders = grants.filter((g) => g.role === role || (role === "committee" && g.role === "committee_member")).map((g) => g.user.toText());
    if (holders.length === 0) continue;
    const existing = chats.find((c) => c.scope === scope);
    const label = role === "referee" ? "Referees" : "Committee";
    if (!existing) {
      const entries: Array<[InstanceType<typeof Principal>, string]> = [[me, "owner"]];
      for (const h of holders) if (h !== me.toText()) entries.push([Principal.fromText(h), "member"]);
      const meta = await messaging.createLiveGroupWithRoles(ctx, clubId, null, `${competitionName} – ${label}`, "competition", entries);
      const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
      await unwrapCandid(actor.set_official_chat(competitionId, scope, meta.conversation_id), "Save competition chat");
    } else {
      try {
        await messaging.addLiveGroupMembers(ctx, existing.conversation_id, holders.map((h) => Principal.fromText(h)));
      } catch {
        // Already members, or the chat was deleted — nothing to add.
      }
    }
  }
}

/** Removes a former official from the matching chat (best-effort). */
export async function removeFromLiveOfficialChat(
  ctx: FeatureBackendContext,
  competitionId: string,
  role: OfficialRole,
  principalText: string,
) {
  const chats = await listLiveOfficialChats(ctx, competitionId);
  const chat = chats.find((c) => c.scope === OFFICIAL_CHAT_SCOPE[role]);
  if (!chat) return;
  const [{ Principal }, { removeLiveGroupMember }] = await Promise.all([
    import("@icp-sdk/core/principal"),
    import("./messaging"),
  ]);
  try {
    await removeLiveGroupMember(ctx, chat.conversation_id, Principal.fromText(principalText));
  } catch {
    // Not a member — nothing to remove.
  }
}

/**
 * Public competition web page read — anonymous by design (the canister method
 * is an unauthenticated query that only returns data for competitions marked
 * public). Uses an AnonymousIdentity so signed-out visitors can open the page.
 */
export async function fetchLivePublicCompetitionPage(competitionId: string) {
  const [{ AnonymousIdentity }, { getActiveIcpTarget }, { connectLiveCompetitionDomain }] =
    await Promise.all([
      import("@icp-sdk/core/agent"),
      import("../targetRegistry"),
      import("../domains"),
    ]);
  const target = getActiveIcpTarget();
  const { readUniquePublicGroup } = await import("../publicGroupReads");
  const value = await readUniquePublicGroup(target, async scoped => {
    const { actor } = await connectLiveCompetitionDomain(scoped, new AnonymousIdentity());
    const result = await actor.get_public_competition_page(competitionId);
    if ("Err" in result) {
      if (result.Err === "Competition not found") return null;
      throw new Error(result.Err);
    }
    return result.Ok;
  });
  if (!value) throw new Error("Competition not found");
  return value;
}

export async function fetchLivePublicRoleLinkPreview(token: string) {
  const [{ AnonymousIdentity }, { getActiveIcpTarget }, { readUniquePublicGroup }] = await Promise.all([
    import("@icp-sdk/core/agent"), import("../targetRegistry"), import("../publicGroupReads"),
  ]);
  return readUniquePublicGroup(getActiveIcpTarget(), target => getLiveRoleLinkPreview({ target, identity: new AnonymousIdentity() }, token));
}

export async function getLiveScorePrivacy(ctx: FeatureBackendContext, competitionId: string) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return actor.get_score_privacy(competitionId);
}
export async function setLiveScorePrivacy(ctx: FeatureBackendContext, competitionId: string, division: string | null, hide: boolean | null) {
  const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_score_privacy(competitionId, candidOpt(division), candidOpt(hide)), "Update score privacy");
}
