import type { FeatureBackendContext } from "../featureRouter";
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

export async function listLiveMembershipClubs(ctx: FeatureBackendContext) {
  return listLiveClubs(ctx);
}

/** The caller's club_domain identity view (account id + roles). */
export async function getLiveMembershipWhoami(ctx: FeatureBackendContext) {
  return liveClubWhoami(ctx);
}
