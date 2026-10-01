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

// ============================================================================
// Newly-upgraded events_domain surfaces (mark_attendance / get_attendance /
// my_attendance, event_roster, my_child_rsvps, child_is_in_event_audience,
// admin_upsert_child / admin_link_guardian, add/remove_event_guest,
// create_recurring_series / detach_occurrence, admin_upsert_rsvp /
// admin_update_rsvp_status). All provisional until verified against a
// deployed canister — see the per-function notes below.
// ============================================================================

export interface LiveAttendanceInput {
  /** "member" | "child" — mirrors the Supabase class_attendance child_id/user_id split. */
  subjectKind: string;
  subjectId: string;
  status: string;
  notes?: string | null;
}

/**
 * Mark attendance for one or more subjects (members/children) against an
 * event. Counterpart of the Supabase `class_attendance` upsert flow — the
 * canister keys attendance by event_id rather than (term_id, team_id,
 * session_date), so callers that mark attendance per-class-session
 * (ClassAttendanceSingle/Manager) must synthesize a stable per-session
 * event_id (provisional: `${teamId}:${sessionDate}`) until classes gain a
 * first-class events_domain Event row.
 */
export async function markLiveAttendance(
  ctx: FeatureBackendContext,
  eventId: string,
  records: LiveAttendanceInput[],
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.mark_attendance(
      eventId,
      records.map((r) => ({
        subject_kind: r.subjectKind,
        subject_id: r.subjectId,
        status: r.status,
        notes: r.notes ?? "",
      })),
    ),
    "Mark attendance",
  );
}

/** All attendance rows recorded against a single event. */
export async function getLiveAttendance(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_attendance(eventId), "Get attendance");
}

/**
 * The caller's own attendance rows (by signed-in principal), optionally
 * scoped to one event. Plain query result (no Ok/Err variant).
 */
export async function getMyLiveAttendance(ctx: FeatureBackendContext, eventId?: string | null) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.my_attendance(candidOpt(eventId));
}

/**
 * Canonical per-event roster (guests + RSVPs-with-child) from the upgraded
 * `event_roster` query. This is the ICP-mode substitute for the Supabase
 * `get_targeted_event_attendance_roster` / event_guests / rsvps reads, which
 * return empty for II-authenticated (principal, not UUID) callers.
 */
export async function getLiveEventRosterDetailed(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.event_roster(eventId), "Get event roster");
}

/**
 * The caller's linked children's RSVPs, optionally scoped to one event
 * and/or club. Counterpart of the Supabase guardian-scoped `rsvps` read for
 * children, which relies on UUID-keyed `child_guardians` rows that
 * principal-based callers never match. Plain query result (no Ok/Err).
 */
export async function getMyLiveChildRsvps(
  ctx: FeatureBackendContext,
  eventId?: string | null,
  clubId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.my_child_rsvps(candidOpt(eventId), candidOpt(clubId));
}

/** Whether a child is part of an event's audience (roster/guardian scope). */
export async function isChildInLiveEventAudience(
  ctx: FeatureBackendContext,
  childId: string,
  eventId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.child_is_in_event_audience(childId, eventId),
    "Check child event audience",
  );
}

/**
 * Admin child-record upsert. Counterpart of the Supabase `children` table
 * write used by child-management flows; provisional — `parentId` here is the
 * events_domain `Child.parent_id` field, not necessarily the same identifier
 * space as Supabase `children.parent_id` (account id vs UUID), verify post-deploy.
 */
export async function adminUpsertLiveChild(
  ctx: FeatureBackendContext,
  id: string,
  name: string,
  parentId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.admin_upsert_child(id, name, candidOpt(parentId)),
    "Upsert child",
  );
}

/**
 * Link a guardian to a child. Counterpart of the Supabase `child_guardians`
 * upsert RPC used by child/guardian admin flows.
 */
export async function adminLinkLiveGuardian(
  ctx: FeatureBackendContext,
  childId: string,
  guardianId: string,
  isPrimary: boolean,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.admin_link_guardian(childId, guardianId, isPrimary),
    "Link guardian",
  );
}

/**
 * Add a guest to an event. Counterpart of the Supabase `event_guests` insert
 * used by EventGuestsManager. `addedBy` is the caller's account id
 * (principal text) — the canister derives the caller from the signed-in
 * identity, so this is informational only / unused server-side today.
 */
export async function addLiveEventGuest(
  ctx: FeatureBackendContext,
  eventId: string,
  guestName: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.add_event_guest(eventId, guestName), "Add guest");
}

/** Remove a guest from an event. Counterpart of the `event_guests` delete. */
export async function removeLiveEventGuest(ctx: FeatureBackendContext, guestId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_event_guest(guestId), "Remove guest");
}

export interface LiveRecurringEventSeriesInput {
  clubId: string;
  teamId?: string | null;
  title: string;
  description: string;
  eventType: string;
  location?: string | null;
  frequency: string;
  firstStartsAtMs: number | Date;
  firstEndsAtMs: number | Date;
  /** Exactly one of occurrences/untilMs is normally supplied; both are optional canister-side. */
  occurrences?: number | null;
  untilMs?: number | Date | null;
}

/**
 * Create a recurring series bounded by an occurrence count OR an end date
 * (the upgraded counterpart of `create_series`, which required `until_ms`).
 * This is the canister-side match for EditEventPage's
 * `convertEventToRecurringSeries` / EventsPage's "create series" flows.
 */
export async function createLiveRecurringEventSeries(
  ctx: FeatureBackendContext,
  input: LiveRecurringEventSeriesInput,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_recurring_series(
      input.clubId,
      candidOpt(input.teamId),
      input.title,
      input.description,
      input.eventType,
      candidOpt(input.location),
      input.frequency,
      toNat64(input.firstStartsAtMs),
      toNat64(input.firstEndsAtMs),
      candidOpt(input.occurrences),
      input.untilMs == null ? [] : [toNat64(input.untilMs)],
    ),
    "Create recurring event series",
  );
}

/**
 * Detach a single occurrence from its series so future series edits/deletes
 * no longer touch it. Counterpart of a "remove this event from the series"
 * action — no Supabase RPC equivalent exists today (Supabase recurring
 * events do not support detaching a single occurrence), so this is an
 * ICP-only capability until a matching Supabase RPC ships.
 */
export async function detachLiveEventOccurrence(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.detach_occurrence(eventId), "Detach occurrence");
}

/**
 * Admin RSVP upsert (set/override another account's or child's RSVP).
 * Counterpart of the Supabase `admin_upsert_rsvp` RPC used by
 * useEventRsvpMutations' admin mutations. `accountId` is the acting-on
 * account's id (principal text, provisional).
 */
export async function adminUpsertLiveRsvp(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
  status: string,
  options?: { childId?: string | null; notes?: string | null },
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.admin_upsert_rsvp(
      eventId,
      accountId,
      candidOpt(options?.childId),
      status,
      options?.notes ?? "",
    ),
    "Admin upsert RSVP",
  );
}

/**
 * Admin RSVP status update by (event, account, child) rather than by RSVP
 * row id — the canister has no row-id lookup, so Supabase's
 * `admin_update_rsvp_status(p_rsvp_id, ...)` is matched by key instead.
 * Counterpart of the Supabase `admin_update_rsvp_status` RPC.
 */
export async function adminUpdateLiveRsvpStatus(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
  status: string,
  childId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.admin_update_rsvp_status(eventId, accountId, candidOpt(childId), status),
    "Admin update RSVP status",
  );
}
