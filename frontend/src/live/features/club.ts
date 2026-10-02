import type { Principal } from "@icp-sdk/core/principal";
import { connectLiveClubDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, unwrapCandid } from "./candid";

/**
 * Club data -> club_domain canister. Shared by the membership and news
 * feature areas (teams/guardians/ACL for membership, club announcements for
 * news).
 *
 * Record-typed writes take the exact candid record type from the generated
 * bindings via `Parameters<>`, so callers pass precisely what the canister
 * expects — fetch-modify-save from the corresponding getter is the safe
 * pattern.
 *
 * NOTE: untested against a live canister until deployment.
 */

type ClubDomainActor = Awaited<ReturnType<typeof connectLiveClubDomain>>["actor"];

export type LiveClubProfile = Parameters<ClubDomainActor["save_club_profile"]>[0];
export type LiveClubSettings = Parameters<ClubDomainActor["save_club_settings"]>[0];
export type LiveClubTeam = Parameters<ClubDomainActor["save_team"]>[0];
export type LiveClubSponsor = Parameters<ClubDomainActor["save_sponsor"]>[0];

export async function getLiveClubProfile(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_club_profile(clubId), "Get club profile");
}

export async function saveLiveClubProfile(ctx: FeatureBackendContext, profile: LiveClubProfile) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.save_club_profile(profile), "Save club profile");
}

export async function getLiveClubSettings(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_club_settings(clubId), "Get club settings");
}

export async function saveLiveClubSettings(ctx: FeatureBackendContext, settings: LiveClubSettings) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.save_club_settings(settings), "Save club settings");
}

export async function listLiveClubs(
  ctx: FeatureBackendContext,
  cursor?: string | null,
  limit = 50,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_clubs(candidOpt(cursor), limit), "List clubs");
}

export async function listLiveTeams(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_teams(clubId), "List teams");
}

export async function getLiveTeam(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_team(teamId), "Get team");
}

export async function saveLiveTeam(ctx: FeatureBackendContext, team: LiveClubTeam) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.save_team(team), "Save team");
}

export async function listLiveSponsors(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_sponsors(clubId), "List sponsors");
}

export async function saveLiveSponsor(ctx: FeatureBackendContext, sponsor: LiveClubSponsor) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.save_sponsor(sponsor), "Save sponsor");
}

export async function deleteLiveSponsor(ctx: FeatureBackendContext, sponsorId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_sponsor(sponsorId), "Delete sponsor");
}

/**
 * Team sponsor allocations (Supabase team_sponsor_allocations counterpart):
 * which sponsors a team displays under its own name in the sponsor strips.
 * The club scope is derived from the sponsor record, so list takes a club id
 * and set takes sponsor + team ids. Writes are club-admin gated canister-side.
 */
export async function listLiveTeamSponsorAllocations(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_team_sponsor_allocations(clubId),
    "List team sponsor allocations",
  );
}

export async function setLiveTeamSponsorAllocation(
  ctx: FeatureBackendContext,
  sponsorId: string,
  teamId: string,
  allocated: boolean,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_team_sponsor_allocation(sponsorId, teamId, allocated),
    "Set team sponsor allocation",
  );
}

/**
 * Rich news posts (the news feed) — the counterpart of the Supabase
 * club_news posts. The single announcement string on club settings stays
 * for the banner surface.
 */
export async function createLiveNewsPost(
  ctx: FeatureBackendContext,
  clubId: string,
  title: string,
  body: string,
  status: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_news_post(clubId, title, body, status),
    "Create news post",
  );
}

export async function updateLiveNewsPost(
  ctx: FeatureBackendContext,
  postId: string,
  title: string,
  body: string,
  status: string,
  expectedRevision: number,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_news_post(postId, title, body, status, BigInt(expectedRevision)),
    "Update news post",
  );
}

export async function deleteLiveNewsPost(ctx: FeatureBackendContext, postId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_news_post(postId), "Delete news post");
}

export async function listLiveNews(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_news(clubId), "List news");
}

/** Cross-club feed: published posts from clubs the caller belongs to. */
export async function listLiveNewsMulti(ctx: FeatureBackendContext, clubIds: string[]) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_news_multi(clubIds), "List news");
}

/**
 * Parent invites — the canister counterpart of the Supabase parent-invite
 * RPCs. create mints a share token; accept atomically links the accepting
 * parent as guardian (+ family link and team assignment).
 */
export async function createLiveParentInvite(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null,
  childId: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_parent_invite(clubId, candidOpt(teamId), childId),
    "Create parent invite",
  );
}

export async function getLiveParentInvite(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_parent_invite(token), "Load parent invite");
}

export async function acceptLiveParentInvite(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.accept_parent_invite(token), "Accept parent invite");
}

export async function liveClubWhoami(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.whoami(), "Whoami");
}

/**
 * Team lifecycle (soft-delete / restore / permanent-delete) — the canister
 * counterpart of the Supabase `teams.deleted_at` tombstone flow.
 */
export async function softDeleteLiveTeam(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.soft_delete_team(teamId), "Delete team");
}

export async function restoreLiveTeam(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.restore_team(teamId), "Restore team");
}

export async function deleteLiveTeamPermanent(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_team_permanent(teamId), "Permanently delete team");
}

/**
 * Club lifecycle (soft-delete / restore / permanent-delete) — the canister
 * counterpart of the Supabase `clubs.deleted_at` tombstone flow.
 */
export async function softDeleteLiveClub(
  ctx: FeatureBackendContext,
  clubId: string,
  cascadeTeams = true,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.soft_delete_club(clubId, cascadeTeams), "Delete club");
}

export async function restoreLiveClub(
  ctx: FeatureBackendContext,
  clubId: string,
  cascadeTeams = true,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.restore_club(clubId, cascadeTeams), "Restore club");
}

export async function deleteLiveClubPermanent(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_club_permanent(clubId), "Permanently delete club");
}

/**
 * Shell-team invites — the canister counterpart of the Supabase
 * `invite_shell_team_to_competition` RPC + `claim_shell_team` flow. A shell
 * team is a placeholder `ClubTeam` created before its club/contact exists;
 * claiming it links the claiming principal as its admin.
 *
 * NOTE: untested against a live canister until deployment. Division
 * assignment and competition-entry linkage stay Supabase-only — the
 * canister shape has no competition/division concept.
 */
export async function createLiveShellTeamInvite(
  ctx: FeatureBackendContext,
  clubId: string,
  name: string,
  contactEmail?: string | null,
  contactName?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_shell_team_invite(clubId, name, candidOpt(contactEmail), candidOpt(contactName)),
    "Invite shell team",
  );
}

export async function getLiveShellTeamByToken(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_shell_team_by_token(token), "Load shell team invite");
}

export async function claimLiveShellTeam(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.claim_shell_team(token), "Claim shell team");
}

/**
 * Team invite links — shareable rotating-token links (distinct from the
 * single-use `TeamInvite` records above).
 */
export async function createLiveTeamInviteLink(
  ctx: FeatureBackendContext,
  teamId: string,
  role: string,
  createdByLabel: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_team_invite_link(teamId, role, createdByLabel),
    "Create team invite link",
  );
}

export async function rotateLiveTeamInviteLink(ctx: FeatureBackendContext, linkId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.rotate_team_invite_link(linkId), "Rotate team invite link");
}

export async function revokeLiveTeamInviteLink(ctx: FeatureBackendContext, linkId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_team_invite_link(linkId), "Revoke team invite link");
}

export async function getLiveTeamInviteLinkByToken(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_team_invite_link_by_token(token),
    "Load team invite link",
  );
}

/**
 * Pending invites — club/team email invites awaiting acceptance.
 */
/**
 * Creates a pending invite. The canister signature is
 * (kind, club_id, team_id, child_id, email, role) — an options object keeps
 * the argument order honest. There is no label/note field on the canister
 * record; the invite id doubles as the /join/p/<id> share token.
 */
export async function createLivePendingInvite(
  ctx: FeatureBackendContext,
  input: {
    kind: "team" | "club" | "guardian";
    clubId: string;
    email: string;
    teamId?: string | null;
    childId?: string | null;
    role?: string | null;
  },
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_pending_invite(
      input.kind,
      input.clubId,
      candidOpt(input.teamId),
      candidOpt(input.childId),
      input.email,
      candidOpt(input.role),
    ),
    "Create pending invite",
  );
}

export async function listLivePendingInvitesByClub(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_pending_invites_by_club(clubId), "List pending invites");
}

export async function resendLivePendingInvite(ctx: FeatureBackendContext, inviteId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.resend_pending_invite(inviteId), "Resend pending invite");
}

export async function revokeLivePendingInvite(ctx: FeatureBackendContext, inviteId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_pending_invite(inviteId), "Revoke pending invite");
}

/**
 * Guardian link/unlink, child-to-parent admin linking, and parent-initiated
 * child creation on a team.
 */
export async function linkLiveGuardian(
  ctx: FeatureBackendContext,
  childId: string,
  guardian: Parameters<ClubDomainActor["link_guardian"]>[1],
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.link_guardian(childId, guardian), "Link guardian");
}

export async function unlinkLiveGuardian(
  ctx: FeatureBackendContext,
  childId: string,
  guardian: Parameters<ClubDomainActor["unlink_guardian"]>[1],
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unlink_guardian(childId, guardian), "Unlink guardian");
}

export async function adminLinkLiveChildToParent(
  ctx: FeatureBackendContext,
  childId: string,
  parent: Parameters<ClubDomainActor["admin_link_child_to_parent"]>[1],
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.admin_link_child_to_parent(childId, parent),
    "Link child to parent",
  );
}

export async function createLiveChildForParentOnTeam(
  ctx: FeatureBackendContext,
  teamId: string,
  childName: string,
  parent: Parameters<ClubDomainActor["create_child_for_parent_on_team"]>[2],
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_child_for_parent_on_team(teamId, childName, parent),
    "Create child for parent",
  );
}

/**
 * Member/child movement between teams and bulk membership operations.
 */
export async function moveLiveMemberToTeam(
  ctx: FeatureBackendContext,
  clubId: string,
  member: Parameters<ClubDomainActor["move_member_to_team"]>[1],
  fromTeamId: string | null,
  toTeamId: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.move_member_to_team(clubId, member, candidOpt(fromTeamId), toTeamId),
    "Move member to team",
  );
}

export async function moveLiveChildToTeam(
  ctx: FeatureBackendContext,
  childId: string,
  fromTeamId: string | null,
  toTeamId: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.move_child_to_team(childId, candidOpt(fromTeamId), toTeamId),
    "Move child to team",
  );
}

export async function bulkAddLiveTeamMembers(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
  role: string,
  members: Parameters<ClubDomainActor["bulk_add_team_members"]>[3],
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.bulk_add_team_members(clubId, teamId, role, members),
    "Bulk add team members",
  );
}

/**
 * Team archive lifecycle — distinct from soft-delete/restore above.
 */
export async function archiveLiveTeam(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.archive_team(teamId), "Archive team");
}

export async function unarchiveLiveTeam(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unarchive_team(teamId), "Unarchive team");
}

/**
 * Team-creation request approve/reject.
 */
export async function approveLiveTeamCreationRequest(ctx: FeatureBackendContext, requestId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.approve_team_creation_request(requestId),
    "Approve team creation request",
  );
}

export async function rejectLiveTeamCreationRequest(ctx: FeatureBackendContext, requestId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.reject_team_creation_request(requestId),
    "Reject team creation request",
  );
}

/**
 * Team player positions.
 */
export async function getLiveTeamPlayerPositions(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_team_player_positions(teamId),
    "Get team player positions",
  );
}

export async function setLiveTeamPlayerPosition(
  ctx: FeatureBackendContext,
  teamId: string,
  memberId: string,
  position: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_team_player_position(teamId, memberId, position),
    "Set team player position",
  );
}

/**
 * Team captains.
 */
export async function addLiveTeamCaptain(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
  member: Parameters<ClubDomainActor["add_team_captain"]>[2],
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_team_captain(clubId, teamId, member),
    "Add team captain",
  );
}

export async function removeLiveTeamCaptain(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
  member: Parameters<ClubDomainActor["remove_team_captain"]>[2],
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.remove_team_captain(clubId, teamId, member),
    "Remove team captain",
  );
}

export async function listLiveTeamCaptains(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_team_captains(teamId), "List team captains");
}

/**
 * Club creation and club join requests.
 */
export async function createLiveClub(
  ctx: FeatureBackendContext,
  name: string,
  slug: string,
  description: string,
  logoUrl?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_club(name, slug, description, candidOpt(logoUrl)),
    "Create club",
  );
}

export async function listLiveClubJoinRequests(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_club_join_requests(clubId),
    "List club join requests",
  );
}

export async function requestLiveClubJoin(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.request_club_join(clubId), "Request club join");
}

export async function approveLiveClubJoinRequest(ctx: FeatureBackendContext, requestId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.approve_club_join_request(requestId),
    "Approve club join request",
  );
}

export async function rejectLiveClubJoinRequest(ctx: FeatureBackendContext, requestId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.reject_club_join_request(requestId),
    "Reject club join request",
  );
}

/**
 * Club theme palette, header toggles, invite email style, and club-switcher
 * hint — all return the updated `ClubSettings`.
 */
export async function setLiveClubThemePalette(
  ctx: FeatureBackendContext,
  clubId: string,
  primaryColor?: string | null,
  secondaryColor?: string | null,
  accentColor?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_club_theme_palette(
      clubId,
      candidOpt(primaryColor),
      candidOpt(secondaryColor),
      candidOpt(accentColor),
    ),
    "Set club theme palette",
  );
}

export async function setLiveClubHeaderToggles(
  ctx: FeatureBackendContext,
  clubId: string,
  showLogo: boolean,
  showSponsor: boolean,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_club_header_toggles(clubId, showLogo, showSponsor),
    "Set club header toggles",
  );
}

export async function setLiveClubInviteEmailStyle(
  ctx: FeatureBackendContext,
  clubId: string,
  style?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_club_invite_email_style(clubId, candidOpt(style)),
    "Set club invite email style",
  );
}

export async function setLiveClubSwitcherHint(
  ctx: FeatureBackendContext,
  clubId: string,
  hint?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_club_switcher_hint(clubId, candidOpt(hint)),
    "Set club switcher hint",
  );
}

/**
 * Per-user theme preference (dark/light/system), stored canister-side.
 */
export async function setLiveThemePreference(ctx: FeatureBackendContext, preference: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_theme_preference(preference), "Set theme preference");
}

export async function getLiveMyThemePreference(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_my_theme_preference(), "Get theme preference");
}

/**
 * Caller-scoped role grants across all clubs — canister counterpart of a
 * cross-club membership read (Supabase equivalent queries `user_roles` for
 * the signed-in user across every club they belong to).
 */
export async function myLiveRoleGrants(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return actor.my_role_grants();
}

/** Auto-accept a pending email invite under the ICP backend (PendingInviteWelcomeDialog). */
export async function acceptPendingLiveInvite(ctx: FeatureBackendContext, inviteId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.accept_pending_invite(inviteId), "Accept pending invite");
}

// ---------------------------------------------------------------------------
// Member soft-delete (round 4): removal keeps records, hidden, reversible.
// ---------------------------------------------------------------------------

export async function removeLiveMember(ctx: FeatureBackendContext, clubId: string, user: Principal) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_member(clubId, user), "Remove member");
}

export async function restoreLiveMember(ctx: FeatureBackendContext, clubId: string, user: Principal) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.restore_member(clubId, user), "Restore member");
}

export async function listLiveRemovedMembers(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_removed_members(clubId), "List removed members");
}

export async function isLiveMemberRemoved(ctx: FeatureBackendContext, clubId: string, user: Principal) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return actor.is_member_removed(clubId, user);
}

/**
 * Compact branding read (name + logo + contact email) for invite/admin
 * surfaces — one query instead of profile + settings.
 */
export async function getLiveClubBranding(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_club_branding(clubId), "Get club branding");
}

/**
 * Club terms (class/season enrolment periods). save_club_term creates when
 * the id is empty/unknown, otherwise updates in place; status is
 * "active" | "archived" | "completed" and active terms may not overlap.
 */
export type LiveClubTerm = Parameters<ClubDomainActor["save_club_term"]>[0];

export async function listLiveClubTerms(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_club_terms(clubId), "List club terms");
}

export async function saveLiveClubTerm(ctx: FeatureBackendContext, term: LiveClubTerm) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.save_club_term(term), "Save club term");
}

export async function setLiveClubTermStatus(ctx: FeatureBackendContext, id: string, status: "active" | "archived" | "completed") {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_club_term_status(id, status), "Set club term status");
}

export async function deleteLiveClubTerm(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_club_term(id), "Delete club term");
}

/**
 * Club-scope child creation — no team required. Used for mini-league-scope
 * parent–child linking where there is no team id (design decision 2, round 4).
 */
export async function createLiveChildForParentInClub(
  ctx: FeatureBackendContext,
  clubId: string,
  parent: Principal,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_child_for_parent_in_club(clubId, parent),
    "Create child for parent in club",
  );
}

/**
 * Manual member payment ledger (Phase 3, F6) — "mark paid" bookkeeping for
 * member subscription/uniform fees, mirroring the Supabase
 * member_subscription_payments table. Bookkeeping only: online payments
 * stay Supabase/Stripe-gated per the payments rule.
 */
export interface LiveMemberPaymentInput {
  clubId: string;
  userId: string;
  childId?: string | null;
  paymentPeriod: string;
  paymentType: string;
  amount: number;
  notes?: string | null;
}

export async function listLiveMemberPayments(
  ctx: FeatureBackendContext,
  clubId: string,
  paymentPeriod: string,
  paymentType: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_member_payments(clubId, paymentPeriod, paymentType),
    "List member payments",
  );
}

export async function markLiveMemberPaid(
  ctx: FeatureBackendContext,
  input: LiveMemberPaymentInput,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.mark_member_paid(
      input.clubId,
      input.userId,
      candidOpt(input.childId),
      input.paymentPeriod,
      input.paymentType,
      input.amount,
      candidOpt(input.notes),
    ),
    "Mark member paid",
  );
}

export async function unmarkLiveMemberPaid(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unmark_member_paid(id), "Unmark member paid");
}

// ---------------------------------------------------------------------------
// Seasons (draft|active|closed|archived) and engagement analytics
// (workstream B) — distinct from ClubTerm. save_season is admin-gated.
// ---------------------------------------------------------------------------

export type LiveSeason = Parameters<ClubDomainActor["save_season"]>[0];

export async function listLiveSeasons(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_seasons(clubId), "List seasons");
}

export async function getLiveCurrentSeason(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_current_season(clubId), "Get current season");
}

export async function saveLiveSeason(ctx: FeatureBackendContext, season: LiveSeason) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.save_season(season), "Save season");
}

// ---------------------------------------------------------------------------
// Season analytics — canister counterpart of the Supabase
// season_team_summary / season_player_stats RPCs. Read-only from the
// hook's perspective; save_* are admin-gated upserts used to keep the
// precomputed stores fresh (club_domain has no events/attendance model to
// derive these from).
// ---------------------------------------------------------------------------

export type LiveSeasonTeamSummary = Parameters<ClubDomainActor["save_season_team_summary"]>[0];
export type LiveSeasonPlayerStat = Parameters<ClubDomainActor["save_season_player_stat"]>[0];

export async function listLiveSeasonTeamSummary(ctx: FeatureBackendContext, seasonId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_season_team_summary(seasonId), "List season team summary");
}

export async function listLiveSeasonPlayerStats(
  ctx: FeatureBackendContext,
  seasonId: string,
  teamId: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_season_player_stats(seasonId, teamId), "List season player stats");
}

export async function saveLiveSeasonTeamSummary(ctx: FeatureBackendContext, entry: LiveSeasonTeamSummary) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.save_season_team_summary(entry), "Save season team summary");
}

export async function saveLiveSeasonPlayerStat(ctx: FeatureBackendContext, entry: LiveSeasonPlayerStat) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.save_season_player_stat(entry), "Save season player stat");
}

/** canister counterpart of the Supabase `profile_team_history` RPC. */
export async function listLiveProfileTeamHistory(ctx: FeatureBackendContext, profileId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return actor.profile_team_history(profileId);
}

/** Admin-gated invite-acceptance analytics over accepted PendingInvite rows. */
export async function listLiveAcceptedInvites(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: bigint,
  untilMs: bigint,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_accepted_invites(clubId, sinceMs, untilMs), "List accepted invites");
}

export async function getLiveInviteStats(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: bigint,
  untilMs: bigint,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.invite_stats(clubId, sinceMs, untilMs), "Invite stats");
}
