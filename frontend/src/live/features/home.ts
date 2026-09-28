import type { FeatureBackendContext } from "../featureRouter";
import { connectLiveEventsDomain } from "../domains";
import { candidOpt, unwrapCandid } from "./candid";
import { listLiveEvents } from "./events";

/**
 * Home feature -> events_domain canister (the home screen's schedule and
 * RSVP summary reads; there is no dedicated home canister in the backend
 * topology).
 *
 * NOTE: untested against a live canister until deployment.
 */

export async function listLiveHomeEvents(ctx: FeatureBackendContext, clubId: string) {
  return listLiveEvents(ctx, clubId, null);
}

export async function listLiveHomeTeamEvents(ctx: FeatureBackendContext, teamId: string) {
  return listLiveEvents(ctx, null, teamId);
}

/**
 * Full events-domain snapshot for the signed-in principal's accessible
 * scope (events, RSVPs, attendance, roster, duties, lineups). Used by the
 * home screen's RSVP summary, which the canister does not expose as a
 * dedicated aggregate query.
 */
export async function getLiveHomeSnapshot(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.export_state(), "Load home snapshot");
}

export { candidOpt };
