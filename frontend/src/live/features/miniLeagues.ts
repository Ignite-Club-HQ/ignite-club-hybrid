import type { Principal } from "@icp-sdk/core/principal";
import { connectLiveMiniLeagueDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, unwrapCandid } from "./candid";

/**
 * Mini-leagues feature -> mini_league_domain canister.
 *
 * Canister-side counterpart of the Supabase `mini_leagues` / `mini_league_*`
 * tables. Routed to only when placement settings resolve ICP for the user
 * AND a mini_league_domain canister ID is configured (see
 * featureBackend.ts); until then every caller stays on Supabase.
 *
 * PROVISIONAL MAPPINGS (verify during the post-deploy sign-in test):
 * - Account id: the canister keys admins/players/claims by `principal`
 *   (II identity), not the Supabase `auth.users` UUID. Browser code must pass
 *   `ctx.identity.getPrincipal()` wherever Supabase used `user.id`.
 * - `created_by` / `claimed_by` / `marked_by` / `granted_by` are principals;
 *   there is no join back to a Supabase profile row, so display name
 *   resolution must go through identity_access profile lookups, not
 *   `profiles`/`auth.users`.
 * - `parent_user_id` on `MiniLeaguePlayer` is left as free-form `opt text`
 *   on the canister (mirrors Supabase's uuid-or-null column) and is
 *   separate from `claimed_by` (principal of whoever claimed the invite).
 * - Club/session/group scoping ids (`club_id`, `mini_league_id`,
 *   `session_id`, `group_id`) are plain text ids mirrored 1:1 from Supabase
 *   primary keys; no re-keying needed.
 * - `list_mini_leagues_by_club` and `my_leagues` / `my_availability` return
 *   plain arrays (no Ok/Err variant) — every other method is unwrapped via
 *   `unwrapCandid`.
 */

// ---------------------------------------------------------------------------
// Mini leagues
// ---------------------------------------------------------------------------

export async function listLiveMiniLeaguesByClub(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return actor.list_mini_leagues_by_club(clubId);
}

export async function listMyLiveMiniLeagues(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return actor.my_leagues();
}

export async function getLiveMiniLeague(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_mini_league(id), "Get mini league");
}

export interface LiveMiniLeagueInput {
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  teamSize: number;
  minPlayersPerSide: number;
  minutesPerHalf: number;
  bibColors: string[];
  showMatchesToMembers: boolean;
}

export async function createLiveMiniLeague(
  ctx: FeatureBackendContext,
  clubId: string,
  input: LiveMiniLeagueInput,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_mini_league(
      clubId,
      input.name,
      candidOpt(input.description),
      candidOpt(input.logoUrl),
      input.teamSize,
      input.minPlayersPerSide,
      input.minutesPerHalf,
      input.bibColors,
      input.showMatchesToMembers,
    ),
    "Create mini league",
  );
}

export async function updateLiveMiniLeague(
  ctx: FeatureBackendContext,
  id: string,
  input: LiveMiniLeagueInput,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_mini_league(
      id,
      input.name,
      candidOpt(input.description),
      candidOpt(input.logoUrl),
      input.teamSize,
      input.minPlayersPerSide,
      input.minutesPerHalf,
      input.bibColors,
      input.showMatchesToMembers,
    ),
    "Update mini league",
  );
}

export async function setLiveMiniLeagueStatus(ctx: FeatureBackendContext, id: string, status: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_mini_league_status(id, status), "Set mini league status");
}

/** Deletes a league and every row scoped to it (sessions, players, groups,
 *  duties, availability, invites, admins, join links). Mirrors the Supabase
 *  FK cascade. */
export async function deleteLiveMiniLeague(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_mini_league(id), "Delete mini league");
}

/** Clones a league with its roster under a new id. Sessions, groups, duties
 *  and availability are not copied — same as the Supabase duplicate flow. */
export async function duplicateLiveMiniLeague(ctx: FeatureBackendContext, id: string, newName: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.duplicate_mini_league(id, newName), "Duplicate mini league");
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface LiveMiniLeagueSessionInput {
  sessionDate: string;
  startTime: string;
  endTime?: string | null;
  locationName?: string | null;
  address?: string | null;
  postcode?: string | null;
  teamSizeOverride?: number | null;
}

export async function listLiveSessions(ctx: FeatureBackendContext, miniLeagueId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_sessions(miniLeagueId), "List sessions");
}

export async function createLiveSession(
  ctx: FeatureBackendContext,
  miniLeagueId: string,
  input: LiveMiniLeagueSessionInput,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_session(
      miniLeagueId,
      input.sessionDate,
      input.startTime,
      candidOpt(input.endTime),
      candidOpt(input.locationName),
      candidOpt(input.address),
      candidOpt(input.postcode),
      candidOpt(input.teamSizeOverride),
    ),
    "Create session",
  );
}

export async function updateLiveSession(
  ctx: FeatureBackendContext,
  id: string,
  input: LiveMiniLeagueSessionInput,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_session(
      id,
      input.sessionDate,
      input.startTime,
      candidOpt(input.endTime),
      candidOpt(input.locationName),
      candidOpt(input.address),
      candidOpt(input.postcode),
      candidOpt(input.teamSizeOverride),
    ),
    "Update session",
  );
}

export async function cancelLiveSession(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.cancel_session(id), "Cancel session");
}

export async function setLiveSessionStatus(ctx: FeatureBackendContext, id: string, status: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_session_status(id, status), "Set session status");
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export async function listLivePlayers(ctx: FeatureBackendContext, miniLeagueId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_players(miniLeagueId), "List players");
}

export async function addLivePlayer(
  ctx: FeatureBackendContext,
  miniLeagueId: string,
  name: string,
  childId?: string | null,
  parentUserId?: string | null,
  abilityRating?: number | null,
  notes?: string | null,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_player(
      miniLeagueId,
      name,
      candidOpt(childId),
      candidOpt(parentUserId),
      candidOpt(abilityRating),
      candidOpt(notes),
    ),
    "Add player",
  );
}

export async function updateLivePlayer(
  ctx: FeatureBackendContext,
  id: string,
  name: string,
  abilityRating?: number | null,
  notes?: string | null,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_player(id, name, candidOpt(abilityRating), candidOpt(notes)),
    "Update player",
  );
}

export async function removeLivePlayer(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_player(id), "Remove player");
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function listLiveInvites(ctx: FeatureBackendContext, miniLeagueId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_invites(miniLeagueId), "List invites");
}

export async function createLiveInvite(
  ctx: FeatureBackendContext,
  miniLeagueId: string,
  playerId?: string | null,
  labelText?: string | null,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_invite(miniLeagueId, candidOpt(playerId), candidOpt(labelText)),
    "Create invite",
  );
}

export async function claimLiveInvite(ctx: FeatureBackendContext, token: string, playerName: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.claim_invite(token, playerName), "Claim invite");
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface LiveMiniLeagueGroupInput {
  name: string;
  abilityBand?: string | null;
  displayOrder: number;
  targetSize: number;
  pitchName?: string | null;
}

export async function listLiveGroups(ctx: FeatureBackendContext, sessionId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_groups(sessionId), "List groups");
}

export async function createLiveGroup(
  ctx: FeatureBackendContext,
  sessionId: string,
  input: LiveMiniLeagueGroupInput,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_group(
      sessionId,
      input.name,
      candidOpt(input.abilityBand),
      input.displayOrder,
      input.targetSize,
      candidOpt(input.pitchName),
    ),
    "Create group",
  );
}

export async function updateLiveGroup(
  ctx: FeatureBackendContext,
  id: string,
  input: LiveMiniLeagueGroupInput,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_group(
      id,
      input.name,
      candidOpt(input.abilityBand),
      input.displayOrder,
      input.targetSize,
      candidOpt(input.pitchName),
    ),
    "Update group",
  );
}

export async function listLiveGroupPlayers(ctx: FeatureBackendContext, groupId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_group_players(groupId), "List group players");
}

export async function assignLivePlayerToGroup(
  ctx: FeatureBackendContext,
  groupId: string,
  playerId: string,
  jerseyNumber?: number | null,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.assign_player_to_group(groupId, playerId, candidOpt(jerseyNumber)),
    "Assign player to group",
  );
}

export async function unassignLivePlayerFromGroup(
  ctx: FeatureBackendContext,
  groupId: string,
  playerId: string,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.unassign_player_from_group(groupId, playerId),
    "Unassign player from group",
  );
}

// ---------------------------------------------------------------------------
// Duties
// ---------------------------------------------------------------------------

export async function listLiveDuties(ctx: FeatureBackendContext, groupId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_duties(groupId), "List duties");
}

export async function createLiveDuty(
  ctx: FeatureBackendContext,
  groupId: string,
  name: string,
  points?: number | null,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.create_duty(groupId, name, candidOpt(points)), "Create duty");
}

export async function claimLiveDuty(ctx: FeatureBackendContext, id: string, playerId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.claim_duty(id, playerId), "Claim duty");
}

export async function completeLiveDuty(ctx: FeatureBackendContext, id: string, pointsAwarded: boolean) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.complete_duty(id, pointsAwarded), "Complete duty");
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export async function setLiveAvailability(
  ctx: FeatureBackendContext,
  sessionId: string,
  playerId: string,
  status: string,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_availability(sessionId, playerId, status), "Set availability");
}

export async function getLiveAvailability(
  ctx: FeatureBackendContext,
  sessionId: string,
  playerId: string,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  const result = await unwrapCandid(actor.get_availability(sessionId, playerId), "Get availability");
  return result.length > 0 ? result[0] : null;
}

export async function listLiveSessionAvailability(ctx: FeatureBackendContext, sessionId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_session_availability(sessionId), "List session availability");
}

export async function listMyLiveAvailability(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return actor.my_availability();
}

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

export async function listLiveAdmins(ctx: FeatureBackendContext, miniLeagueId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_admins(miniLeagueId), "List admins");
}

export async function addLiveAdmin(ctx: FeatureBackendContext, miniLeagueId: string, userId: Principal) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.add_admin(miniLeagueId, userId), "Add admin");
}

export async function removeLiveAdmin(ctx: FeatureBackendContext, miniLeagueId: string, userId: Principal) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_admin(miniLeagueId, userId), "Remove admin");
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function initializeLiveMiniLeagueDomain(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.initialize(), "Initialize mini league domain");
}

export async function grantLiveMiniLeagueRole(
  ctx: FeatureBackendContext,
  principal: Principal,
  role: string,
  clubId: string,
  teamId?: string | null,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.grant_role(principal, role, clubId, candidOpt(teamId)), "Grant role");
}

// ---------------------------------------------------------------------------
// Join links
// ---------------------------------------------------------------------------

/** Shareable rotating-token join links, counterpart of the invite flow above.
 *  Each league holds at most one active link per role: "player" links mint a
 *  roster player on claim, "admin" links grant league-admin rights. */
export type LiveJoinLinkRole = "player" | "admin";

export async function createLiveMiniLeagueJoinLink(
  ctx: FeatureBackendContext,
  miniLeagueId: string,
  role: LiveJoinLinkRole = "player",
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.create_mini_league_join_link(miniLeagueId, role), "Create mini league join link");
}

export async function rotateLiveMiniLeagueJoinLink(
  ctx: FeatureBackendContext,
  miniLeagueId: string,
  role: LiveJoinLinkRole = "player",
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.rotate_mini_league_join_link(miniLeagueId, role), "Rotate mini league join link");
}

export async function revokeLiveMiniLeagueJoinLink(
  ctx: FeatureBackendContext,
  miniLeagueId: string,
  role: LiveJoinLinkRole = "player",
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_mini_league_join_link(miniLeagueId, role), "Revoke mini league join link");
}

export async function listLiveMiniLeagueJoinLinks(ctx: FeatureBackendContext, miniLeagueId: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_mini_league_join_links(miniLeagueId), "List mini league join links");
}

/** Resolves a join-link token to its league and role for the claim page. */
export async function getLiveJoinLinkByToken(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_join_link_by_token(token), "Get join link");
}

/** Claims an admin join link: grants the caller league-admin rights. */
export async function claimLiveAdminJoinLink(ctx: FeatureBackendContext, token: string) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.claim_admin_join_link(token), "Claim admin join link");
}

export async function joinLiveMiniLeagueByToken(
  ctx: FeatureBackendContext,
  token: string,
  playerName: string,
) {
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.join_mini_league_by_token(token, playerName), "Join mini league");
}
