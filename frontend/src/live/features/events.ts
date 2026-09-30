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
  /** Mirrors the Supabase event_type enum: game | training | social | mini_league. */
  eventType: string;
  location?: string | null;
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

/**
 * The caller's own RSVPs (events_domain `my_rsvps` query). Caller-scoped
 * counterpart of the governor-gated export_state snapshot, for member-facing
 * surfaces like the home feed. Plain query result (no Ok/Err variant).
 */
export async function listLiveMyRsvps(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.my_rsvps();
}

export async function createLiveEvent(ctx: FeatureBackendContext, input: LiveEventInput) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_event(
      input.clubId,
      candidOpt(input.teamId),
      input.title,
      input.description,
      input.eventType,
      candidOpt(input.location),
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
      input.eventType,
      candidOpt(input.location),
      toNat64(input.startsAtMs),
      toNat64(input.endsAtMs),
    ),
    "Update event",
  );
}

/**
 * Cancellation is a dedicated canister method so cancelling cannot clobber
 * other fields with stale browser state (see events_domain main.mo).
 */
export async function setLiveEventCancelled(
  ctx: FeatureBackendContext,
  eventId: string,
  cancelled: boolean,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_event_cancelled(eventId, cancelled),
    cancelled ? "Cancel event" : "Reinstate event",
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

/**
 * Canonical per-event roster read (accounts + linked children) used for
 * guardian/attendance rosters. Counterpart of the Supabase
 * `get_targeted_event_attendance_roster` / `club_scoped_child_guardians`
 * RPCs, which return empty results for II-authenticated (principal, not
 * UUID) callers — this is the ICP-mode substitute.
 */
export async function getLiveEventRoster(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_event_roster(eventId), "Get event roster");
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

/**
 * Duty completion surface. The canister keys duties by (event, account), so
 * these only cover assigned duties — open duties with no assignee have no
 * canister shape and stay Supabase-only. Provisional: the account id is
 * browser-supplied until account ids are bound to principals
 * (identity_access).
 */
export async function completeLiveEventDuty(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.complete_duty(eventId, accountId), "Complete duty");
}

export async function uncompleteLiveEventDuty(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.uncomplete_duty(eventId, accountId), "Reopen duty");
}

export async function removeLiveEventDuty(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_duty(eventId, accountId), "Remove duty");
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

export interface LiveEventSeriesInput {
  clubId: string;
  teamId?: string | null;
  title: string;
  description: string;
  eventType: string;
  location?: string | null;
  frequency: string;
  firstStartsAtMs: number | Date;
  firstEndsAtMs: number | Date;
  untilMs: number | Date;
}

/**
 * Recurring series surface. create_series generates the child events
 * canister-side (the counterpart of the Supabase RPC's child-date
 * expansion); update_series rewrites future children from fromMs;
 * delete_series removes future children and truncates the series.
 */
export async function createLiveEventSeries(
  ctx: FeatureBackendContext,
  input: LiveEventSeriesInput,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_series(
      input.clubId,
      candidOpt(input.teamId),
      input.title,
      input.description,
      input.eventType,
      candidOpt(input.location),
      input.frequency,
      toNat64(input.firstStartsAtMs),
      toNat64(input.firstEndsAtMs),
      toNat64(input.untilMs),
    ),
    "Create event series",
  );
}

export async function updateLiveEventSeries(
  ctx: FeatureBackendContext,
  seriesId: string,
  input: {
    title: string;
    description: string;
    eventType: string;
    location?: string | null;
    fromMs: number | Date;
  },
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_series(
      seriesId,
      input.title,
      input.description,
      input.eventType,
      candidOpt(input.location),
      toNat64(input.fromMs),
    ),
    "Update event series",
  );
}

export async function deleteLiveEventSeries(
  ctx: FeatureBackendContext,
  seriesId: string,
  fromMs: number | Date,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.delete_series(seriesId, toNat64(fromMs)),
    "Delete event series",
  );
}

export async function listLiveEventSeries(
  ctx: FeatureBackendContext,
  clubId?: string | null,
  teamId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.list_series(candidOpt(clubId), candidOpt(teamId));
}

export interface LiveLineupPlayer {
  member: string;
  slot: string;
  number?: number | null;
  x?: number | null;
  y?: number | null;
  bench: boolean;
}

/**
 * Full lineup snapshot (formation, ball position, bench, coordinates) — the
 * richer counterpart of add_lineup, which only mirrors on-pitch members.
 */
export async function saveLiveLineupSnapshot(
  ctx: FeatureBackendContext,
  eventId: string,
  input: {
    teamId?: string | null;
    formation?: string | null;
    teamSize: number;
    ballX?: number | null;
    ballY?: number | null;
    players: LiveLineupPlayer[];
  },
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.save_lineup_snapshot(
      eventId,
      candidOpt(input.teamId),
      candidOpt(input.formation),
      input.teamSize,
      candidOpt(input.ballX),
      candidOpt(input.ballY),
      input.players.map((p) => ({
        member: p.member,
        slot: p.slot,
        number: candidOpt(p.number),
        x: candidOpt(p.x),
        y: candidOpt(p.y),
        bench: p.bench,
      })),
    ),
    "Save lineup",
  );
}

export async function getLiveLineupSnapshot(
  ctx: FeatureBackendContext,
  eventId: string,
  teamId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_lineup_snapshot(eventId, candidOpt(teamId)),
    "Load lineup",
  );
}

/**
 * Full events-domain snapshot (events, RSVPs, attendance, roster, duties,
 * lineups, recurrences). The canister exposes no per-event RSVP/attendance
 * query, so reads that need them filter this snapshot client-side.
 */
export async function getLiveEventsSnapshot(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.export_state(), "Load events snapshot");
}


/**
 * Multi-event counterpart of getLiveEventRoster, used by EventsPage.tsx to
 * derive which teams/clubs the II caller's linked children are rostered on.
 * events_domain has no child_guardians/children/child_team_assignments
 * tables (those are Supabase-only), so instead of a single roster read we
 * fan get_event_roster (getLiveEventRoster) out across every event visible
 * to the caller and keep only rows for this account. Best-effort: a failed
 * per-event roster read is skipped rather than failing the whole scope.
 */
export async function getLiveAccountRosterScope(
  ctx: FeatureBackendContext,
  accountId: string,
) {
  const events = (await listLiveEvents(ctx)) as Array<{
    id?: string;
    team_id?: [] | [string];
    club_id?: string;
  }>;
  const teamIds = new Set<string>();
  const clubIds = new Set<string>();
  const childIds = new Set<string>();

  await Promise.all(
    (events ?? []).map(async (event) => {
      if (!event?.id) return;
      let rows: Array<{ account_id?: string; child_id?: [] | [string] }> = [];
      try {
        rows = (await getLiveEventRoster(ctx, event.id)) as typeof rows;
      } catch {
        return;
      }
      const mineRows = (rows ?? []).filter((r) => r.account_id === accountId);
      if (mineRows.length === 0) return;
      const team = Array.isArray(event.team_id) && event.team_id.length > 0 ? event.team_id[0] : null;
      if (team) teamIds.add(team);
      if (event.club_id) clubIds.add(event.club_id);
      for (const row of mineRows) {
        const child = Array.isArray(row.child_id) && row.child_id.length > 0 ? row.child_id[0] : null;
        if (child) childIds.add(child);
      }
    }),
  );

  return {
    childIds: Array.from(childIds),
    teamIds: Array.from(teamIds),
    clubIds: Array.from(clubIds),
  };
}
