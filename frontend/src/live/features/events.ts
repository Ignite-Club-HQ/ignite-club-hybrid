import { connectLiveEventsDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, toNat64, unwrapCandid } from "./candid";

/**
 * Events feature -> events_domain canister.
 *
 * Canister-side counterpart of the Supabase repositories in
 * `features/events/`. Routed to only when placement settings resolve ICP for
 * the user AND an events_domain canister ID is configured (see
 * featureBackend.ts); until then every caller stays on Supabase.
 *
 * NOTE: untested against a live canister until deployment — verify the field
 * mapping (account_id vs Supabase user ids, ms timestamps) during the
 * post-deploy sign-in test.
 */

export interface LiveEventInput {
  clubId: string;
  teamId?: string | null;
  title: string;
  description: string;
  startsAtMs: number | Date;
  endsAtMs: number | Date;
}

export async function listLiveEvents(
  ctx: FeatureBackendContext,
  clubId?: string | null,
  teamId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.list_events(candidOpt(clubId), candidOpt(teamId));
}

export async function createLiveEvent(ctx: FeatureBackendContext, input: LiveEventInput) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_event(
      input.clubId,
      candidOpt(input.teamId),
      input.title,
      input.description,
      toNat64(input.startsAtMs),
      toNat64(input.endsAtMs),
    ),
    "Create event",
  );
}

export async function updateLiveEvent(
  ctx: FeatureBackendContext,
  eventId: string,
  input: Omit<LiveEventInput, "clubId" | "teamId">,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_event(
      eventId,
      input.title,
      input.description,
      toNat64(input.startsAtMs),
      toNat64(input.endsAtMs),
    ),
    "Update event",
  );
}

export async function setLiveEventRsvp(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
  state: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_rsvp(eventId, accountId, state), "Set RSVP");
}

export async function setLiveEventAttendance(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
  present: boolean,
  note: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_attendance(eventId, accountId, present, note),
    "Set attendance",
  );
}

export async function setLiveEventRoster(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
  childId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_roster(eventId, accountId, candidOpt(childId)),
    "Set roster",
  );
}

export async function setLiveEventDuty(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
  duty: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_duty(eventId, accountId, duty), "Set duty");
}

export async function addLiveEventLineup(
  ctx: FeatureBackendContext,
  eventId: string,
  member: string,
  slot: string,
  teamId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_lineup(eventId, member, slot, candidOpt(teamId)),
    "Add lineup entry",
  );
}

export async function setLiveEventRecurrence(
  ctx: FeatureBackendContext,
  eventId: string,
  frequency: string,
  untilMs: number | Date,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_recurrence(eventId, frequency, toNat64(untilMs)),
    "Set recurrence",
  );
}
