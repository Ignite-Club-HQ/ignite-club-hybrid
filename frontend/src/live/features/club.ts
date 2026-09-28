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

export async function liveClubWhoami(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.whoami(), "Whoami");
}
