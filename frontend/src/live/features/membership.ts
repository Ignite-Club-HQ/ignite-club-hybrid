import type { Principal } from "@icp-sdk/core/principal";
import { connectLiveClubDomain } from "../domains";
import { connectLiveIdentityAccessClientWithIdentity } from "../identityAccess";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, unwrapCandid } from "./candid";
import {
  getLiveTeam,
  listLiveClubs,
  listLiveTeams,
  liveClubWhoami,
  saveLiveTeam,
  type LiveClubTeam,
} from "./club";

/**
 * Membership feature -> club_domain canister (teams, guardians and the ACL
 * live there; account/role linking itself lives in identity_access, which
 * the sign-in flow already calls).
 *
 * NOTE: untested against a live canister until deployment. Role/ACL changes
 * go through the canister's `mutate`/`replace_acl` governance surface, which
 * is intentionally not exposed to the browser yet — membership writes here
 * cover team records only.
 */

export async function listLiveMembershipTeams(ctx: FeatureBackendContext, clubId: string) {
  return listLiveTeams(ctx, clubId);
}

export async function getLiveMembershipTeam(ctx: FeatureBackendContext, teamId: string) {
  return getLiveTeam(ctx, teamId);
}

export async function saveLiveMembershipTeam(ctx: FeatureBackendContext, team: LiveClubTeam) {
  return saveLiveTeam(ctx, team);
}

/** Club-admin gated on the canister; returns account role grants for the club. */
export async function listLiveRoleGrants(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_role_grants(clubId), "List role grants");
}

/** Caller-scoped: children linked to the signed-in member's account. */
export async function listLiveChildren(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_children(), "List children");
}

export async function listLiveMembershipClubs(ctx: FeatureBackendContext) {
  return listLiveClubs(ctx);
}

/**
 * The caller's own role grants across every club (club_domain `my_role_grants`
 * query) — used for admin / Pro-feature / pitch-board access checks that
 * previously relied on Supabase `user_roles` rows keyed by the II principal.
 */
export async function getLiveMyRoleGrants(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return actor.my_role_grants();
}

/** The caller's club_domain identity view (account id + roles). */
export async function getLiveMembershipWhoami(ctx: FeatureBackendContext) {
  return liveClubWhoami(ctx);
}

/**
 * ACL role grants — direct add/remove of an `AccountRole` entry (club_admin
 * / team_admin / coach / etc.). `team` scopes the grant to a team; omit for
 * a club-wide grant.
 */
export async function addLiveRoleGrant(
  ctx: FeatureBackendContext,
  user: Principal,
  club: string,
  role: string,
  team?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_role_grant(user, club, role, candidOpt(team)),
    "Add role grant",
  );
}

export async function removeLiveRoleGrant(
  ctx: FeatureBackendContext,
  user: Principal,
  club: string,
  role: string,
  team?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.remove_role_grant(user, club, role, candidOpt(team)),
    "Remove role grant",
  );
}

/** Removes every role grant a member holds in a club (all teams included). */
export async function removeLiveMember(
  ctx: FeatureBackendContext,
  club: string,
  user: Principal,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_member(club, user), "Remove member");
}

/**
 * Self-service role requests — the canister counterpart of the Supabase
 * `role_requests` table (a member asks for a role; a club/team admin
 * approves or rejects it).
 */
export async function requestLiveRole(
  ctx: FeatureBackendContext,
  club: string,
  role: string,
  team?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.request_role(club, role, candidOpt(team)),
    "Request role",
  );
}

export async function listLiveRoleRequests(ctx: FeatureBackendContext, club: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_role_requests(club), "List role requests");
}

export async function approveLiveRoleRequest(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.approve_role_request(id), "Approve role request");
}

export async function rejectLiveRoleRequest(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.reject_role_request(id), "Reject role request");
}

/**
 * Pending invite acceptance — the canister counterpart of the JoinClubPage
 * "shareable invite link" flow. The URL token doubles as the canister's
 * `PendingInvite.id` (see club.ts `createLivePendingInvite`), so accepting
 * is a single `accept_pending_invite(id)` call; there is no separate
 * "preview without accepting" query on the canister yet.
 */
export async function acceptLiveMembershipPendingInvite(ctx: FeatureBackendContext, inviteId: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.accept_pending_invite(inviteId), "Accept pending invite");
}

/**
 * Team invites — token-based invite links scoped to a team, the canister
 * counterpart of the Supabase `pending_invites`/team-invite RPCs. Unlike the
 * Supabase flow, the canister does not send email; callers must surface the
 * invite link/id through their own channel.
 */
export async function createLiveTeamInvite(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
  email: string,
  role: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_team_invite(clubId, teamId, email, role),
    "Create team invite",
  );
}

export async function listLiveTeamInvites(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId?: string | null,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_team_invites(clubId, candidOpt(teamId)),
    "List team invites",
  );
}

export async function getLiveTeamInvite(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_team_invite(id), "Load team invite");
}

export async function acceptLiveTeamInvite(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.accept_team_invite(id), "Accept team invite");
}

export async function revokeLiveTeamInvite(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_team_invite(id), "Revoke team invite");
}

/**
 * Team lifecycle re-exports (club_domain owns team records; see club.ts for
 * the underlying implementation).
 */
export {
  softDeleteLiveTeam,
  restoreLiveTeam,
  deleteLiveTeamPermanent,
  softDeleteLiveClub,
  restoreLiveClub,
  deleteLiveClubPermanent,
  createLiveShellTeamInvite,
  getLiveShellTeamByToken,
  claimLiveShellTeam,
} from "./club";

/**
 * Fuzzy display-name search over identity_access profiles — the ICP-mode
 * counterpart of the Supabase `search_invitable_profiles` RPC, used by the
 * "add an existing member" pickers. Each result carries the account's first
 * principal, which doubles as the user id for role grants.
 */
export async function searchLiveInvitableProfiles(
  ctx: FeatureBackendContext,
  query: string,
  limit = 10,
) {
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
  try {
    const results = await client.searchProfiles(query.trim(), limit);
    return results.map((r) => ({
      id: r.principal.toText(),
      account_id: r.account_id,
      display_name: r.display_name,
      avatar_ref: r.avatar_ref[0] ?? null,
    }));
  } finally {
    client.dispose();
  }
}
