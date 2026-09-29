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
