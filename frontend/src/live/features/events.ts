import { connectLiveEventsDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, toNat64, unwrapCandid } from "./candid";
import { grantLiveClubPiiRead, registerLivePiiText, resolveLivePiiTextBatch } from "./vault";

// Team ids are canister-generated as "team-<club_id>-<n>-<ns>", so the club
// id can be recovered by stripping the two trailing segments. Used to seed
// club-scoped PII read grants without threading clubId through every caller.
// Returns null when the id doesn't match the expected shape (best effort).
function clubIdFromTeamId(teamId: string): string | null {
  if (!teamId.startsWith("team-")) return null;
  const rest = teamId.slice(5);
  const last = rest.lastIndexOf("-");
  if (last <= 0) return null;
  const secondLast = rest.lastIndexOf("-", last - 1);
  if (secondLast <= 0) return null;
  return rest.slice(0, secondLast);
}

// Fill-in and MVP player names are PII: they are registered on
// pii_access_control under opaque references and only the reference is
// stored on events_domain. The club read grant lets club members decrypt
// the names when rendering stats/history. All registration is best effort.
async function registerFillInNameRef(
  ctx: FeatureBackendContext,
  eventId: string,
  teamId: string,
  name: string,
): Promise<string> {
  const ref = `fillin:${eventId}:${crypto.randomUUID()}`;
  await registerLivePiiText(ctx, ref, "name", name);
  const clubId = clubIdFromTeamId(teamId);
  if (clubId) await grantLiveClubPiiRead(ctx, ref, "name", clubId);
  return ref;
}

async function registerMvpNameRef(
  ctx: FeatureBackendContext,
  input: LiveGameResultInput,
  name: string,
): Promise<string> {
  const ref = `mvp:${input.eventId ?? `${input.teamId}:${crypto.randomUUID()}`}`;
  await registerLivePiiText(ctx, ref, "name", name);
  const clubId = clubIdFromTeamId(input.teamId);
  if (clubId) await grantLiveClubPiiRead(ctx, ref, "name", clubId);
  return ref;
}

async function resolveNameRefs(
  ctx: FeatureBackendContext,
  refs: string[],
  operation: string,
): Promise<Map<string, string>> {
  return resolveLivePiiTextBatch(ctx, refs, "name", operation, "Player names");
}

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
  /** Game opponent label (Supabase events.opponent). */
  opponent?: string | null;
  /** Venue street address (Supabase events.address). */
  address?: string | null;
  /** Link to the owning mini league (Supabase events.mini_league_id). */
  miniLeagueId?: string | null;
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
      candidOpt(input.opponent),
      candidOpt(input.address),
      candidOpt(input.miniLeagueId),
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
      candidOpt(input.opponent),
      candidOpt(input.address),
      candidOpt(input.miniLeagueId),
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

/**
 * Association-scoped fan-out (Phase 3, F5): creates the same social event in
 * every selected member club via events_domain `create_association_event`.
 * Returns the number of clubs the event was created for.
 */
export interface LiveAssociationEventInput {
  associationId: string;
  clubIds: string[];
  title: string;
  description: string;
  location?: string | null;
  startsAtMs: number | Date;
  endsAtMs: number | Date;
}

export async function createLiveAssociationEvent(
  ctx: FeatureBackendContext,
  input: LiveAssociationEventInput,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_association_event(
      input.associationId,
      input.clubIds,
      input.title,
      input.description,
      candidOpt(input.location),
      toNat64(input.startsAtMs),
      toNat64(input.endsAtMs),
    ),
    "Create association event",
  );
}

/**
 * Association panel read (Phase 3, F5): parent records for one association,
 * each carrying child_event_ids so the panel can show fan-out counts.
 */
export async function listLiveAssociationEvents(
  ctx: FeatureBackendContext,
  associationId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_association_events(associationId),
    "List association events",
  );
}

/**
 * Child display record for award flows (Phase 3, F8): events_domain
 * `get_event_child`, gated canister-side to managers of the event.
 */
export async function getLiveEventChild(
  ctx: FeatureBackendContext,
  eventId: string,
  childId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_event_child(eventId, childId), "Get event child");
}

export async function setLiveEventRsvp(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
  state: string,
  notes = "",
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_rsvp(eventId, accountId, state, notes), "Set RSVP");
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
  // events_domain Child records are nameless (PII hardening); the name lives
  // on pii_access_control under pii_id=child id and is registered by the
  // caller (registerLiveChildNamePii), never sent to the canister.
  void name;
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.admin_upsert_child(id, candidOpt(parentId)),
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

// ============================================================================
// Further events_domain surfaces: hard delete / soft-delete series, coach
// notes, series occurrences, event views, reminder logs, push reachability,
// event groups + group players/duties, team training pauses, membership
// checks, open duties, and mini-league RSVPs. All provisional until verified
// against a deployed canister.
// ============================================================================

/** Hard delete of an event row (distinct from set_event_cancelled's soft flag). */
export async function deleteLiveEvent(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_event(eventId), "Delete event");
}

/** Soft-delete a series record itself (distinct from delete_series, which truncates future child events). */
export async function softDeleteLiveEventSeries(ctx: FeatureBackendContext, seriesId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.soft_delete_series(seriesId), "Delete event series");
}

/** Coach-only note attached to an event. Counterpart of a Supabase coach-notes field, read side. */
export async function getLiveCoachNote(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_coach_note(eventId), "Get coach note");
}

export async function setLiveCoachNote(ctx: FeatureBackendContext, eventId: string, note: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_coach_note(eventId, note), "Set coach note");
}

/**
 * Append a single occurrence to an existing series without rewriting the
 * whole future tail (distinct from create_series/update_series).
 */
export async function addLiveSeriesOccurrence(
  ctx: FeatureBackendContext,
  seriesId: string,
  startsAtMs: number | Date,
  endsAtMs: number | Date,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_series_occurrence(seriesId, toNat64(startsAtMs), toNat64(endsAtMs)),
    "Add series occurrence",
  );
}

/** Record that the caller viewed an event (analytics). */
export async function recordLiveEventView(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.record_event_view(eventId), "Record event view");
}

export async function getLiveEventViewCount(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_event_view_count(eventId), "Get event view count");
}

/** Reminder-send audit log (e.g. "RSVP reminder sent to X via push"). */
export async function recordLiveReminderSent(
  ctx: FeatureBackendContext,
  eventId: string,
  channel: string,
  recipient: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.record_reminder_sent(eventId, channel, recipient),
    "Record reminder sent",
  );
}

export async function listLiveReminders(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_reminders(eventId), "List reminders");
}

/**
 * Per-principal push reachability flag (whether push notifications can reach
 * the signed-in caller's device). `get_push_reachable` takes a Principal, not
 * an account id string.
 */
export async function setLivePushReachable(ctx: FeatureBackendContext, reachable: boolean) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_push_reachable(reachable), "Set push reachability");
}

export async function getLivePushReachable(
  ctx: FeatureBackendContext,
  principal: import("@icp-sdk/core/principal").Principal,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_push_reachable(principal), "Get push reachability");
}

/**
 * Event groups (e.g. training squads/pods within an event) and their player
 * membership + per-group duties. Counterpart of a Supabase event-groups
 * feature with no direct RPC equivalent today.
 */
export async function createLiveEventGroup(
  ctx: FeatureBackendContext,
  eventId: string,
  name: string,
  teamLetter?: string | null,
  colour?: string | null,
  abilityBand?: string | null,
  pitchName?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_event_group(
      eventId,
      name,
      candidOpt(teamLetter),
      candidOpt(colour),
      candidOpt(abilityBand),
      candidOpt(pitchName),
    ),
    "Create event group",
  );
}

export async function renameLiveEventGroup(
  ctx: FeatureBackendContext,
  groupId: string,
  name: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.rename_event_group(groupId, name), "Rename event group");
}

export async function deleteLiveEventGroup(ctx: FeatureBackendContext, groupId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_event_group(groupId), "Delete event group");
}

export async function listLiveEventGroups(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_event_groups(eventId), "List event groups");
}

export async function addLiveGroupPlayer(
  ctx: FeatureBackendContext,
  groupId: string,
  accountId: string,
  teamLetter?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_group_player(groupId, accountId, candidOpt(teamLetter)),
    "Add group player",
  );
}

export async function removeLiveGroupPlayer(
  ctx: FeatureBackendContext,
  groupId: string,
  accountId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_group_player(groupId, accountId), "Remove group player");
}

export async function listLiveGroupPlayers(ctx: FeatureBackendContext, groupId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_group_players(groupId), "List group players");
}

export async function moveLiveGroupPlayer(
  ctx: FeatureBackendContext,
  fromGroupId: string,
  toGroupId: string,
  accountId: string,
  teamLetter?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.move_group_player(fromGroupId, toGroupId, accountId, candidOpt(teamLetter)),
    "Move group player",
  );
}

export async function swapLiveGroupPlayers(
  ctx: FeatureBackendContext,
  groupA: string,
  accountA: string,
  teamA: string | null | undefined,
  groupB: string,
  accountB: string,
  teamB?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.swap_group_players(groupA, accountA, candidOpt(teamA), groupB, accountB, candidOpt(teamB)),
    "Swap group players",
  );
}

export async function setLiveGroupDuty(
  ctx: FeatureBackendContext,
  groupId: string,
  duty: string,
  accountId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_group_duty(groupId, duty, candidOpt(accountId)),
    "Set group duty",
  );
}

export async function removeLiveGroupDuty(
  ctx: FeatureBackendContext,
  groupId: string,
  duty: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_group_duty(groupId, duty), "Remove group duty");
}

export async function listLiveGroupDuties(ctx: FeatureBackendContext, groupId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_group_duties(groupId), "List group duties");
}

export async function setLiveRsvpNote(
  ctx: FeatureBackendContext,
  eventId: string,
  accountId: string,
  notes: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_rsvp_note(eventId, accountId, notes), "Set RSVP note");
}

export async function sendLiveEventReminders(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.send_event_reminders(eventId), "Send event reminders");
}

/**
 * Team training pauses (e.g. holiday breaks) — counterpart of a Supabase
 * `team_training_pauses` table used to suppress auto-generated training
 * events for a date range.
 */
export async function createLiveTeamTrainingPause(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
  startsAtMs: number | Date,
  endsAtMs: number | Date,
  reason: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_team_training_pause(
      clubId,
      teamId,
      toNat64(startsAtMs),
      toNat64(endsAtMs),
      reason,
    ),
    "Create team training pause",
  );
}

export async function listLiveTeamTrainingPauses(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_team_training_pauses(clubId, teamId),
    "List team training pauses",
  );
}

export async function deleteLiveTeamTrainingPause(ctx: FeatureBackendContext, pauseId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_team_training_pause(pauseId), "Delete team training pause");
}

export async function isLiveTeamTrainingPaused(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
  atMs: number | Date,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.is_paused(clubId, teamId, toNat64(atMs)), "Check training pause");
}

/**
 * Membership/guardianship checks against the events_domain role table.
 * Plain boolean query results (no Ok/Err variant) — the canister never
 * errors on these, it just reports false for principals with no matching
 * grant/link.
 */
export async function isLiveTeamMember(
  ctx: FeatureBackendContext,
  principal: import("@icp-sdk/core/principal").Principal,
  clubId: string,
  teamId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.is_team_member(principal, clubId, teamId);
}

export async function isLiveGuardianOf(
  ctx: FeatureBackendContext,
  principal: import("@icp-sdk/core/principal").Principal,
  childId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.is_guardian_of(principal, childId);
}

/**
 * Open (unassigned) duties — distinct from the assignee-keyed duties above,
 * these can be claimed/unclaimed by any eligible account. Counterpart of a
 * Supabase "duty board" flow with no assignee until claimed.
 */
export async function createLiveOpenDuty(
  ctx: FeatureBackendContext,
  eventId: string,
  duty: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.create_open_duty(eventId, duty), "Create open duty");
}

export async function claimLiveOpenDuty(
  ctx: FeatureBackendContext,
  dutyId: string,
  accountId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.claim_open_duty(dutyId, accountId), "Claim open duty");
}

export async function unclaimLiveOpenDuty(ctx: FeatureBackendContext, dutyId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unclaim_open_duty(dutyId), "Unclaim open duty");
}

export async function listLiveOpenDuties(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_open_duties(eventId), "List open duties");
}

/**
 * Mini-league RSVP subject — either a registered account or a
 * mini-league-only player record (no Supabase account/profile row). Mirrors
 * the raw candid `RsvpSubject` variant shape (`{ account }` /
 * `{ mini_league_player }`), not the bindgen `__kind__` wrapper.
 */
export type LiveRsvpSubject = { account: string } | { mini_league_player: string };

export async function setLiveMiniLeagueRsvp(
  ctx: FeatureBackendContext,
  eventId: string,
  subject: LiveRsvpSubject,
  state: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_mini_league_rsvp(eventId, subject, state),
    "Set mini-league RSVP",
  );
}

export async function listLiveMiniLeagueRsvps(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_mini_league_rsvps(eventId), "List mini-league RSVPs");
}

/**
 * Child occurrences generated for a series (id/deleted/starts/ends only) —
 * used to safely derive how a series' end date edit should trim or extend
 * its existing children without re-deriving dates client-side.
 */
export async function listLiveSeriesOccurrences(ctx: FeatureBackendContext, seriesId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_series_occurrences(seriesId), "List series occurrences");
}

/** Reminder-send summary for an event (recipient count + last-sent time). */
export async function getLiveReminderLog(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_reminder_log(eventId), "Get reminder log");
}

/** Push-reachability check keyed by account id string (distinct from get_push_reachable's Principal). */
export async function isLiveReachable(ctx: FeatureBackendContext, accountId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.is_reachable(accountId), "Check reachability");
}

/**
 * Event-group appearance (team letter, colour, ability band, pitch name) —
 * used by the auto-generate/team-colour/ability-band group UI.
 */
export async function setLiveEventGroupAppearance(
  ctx: FeatureBackendContext,
  groupId: string,
  teamLetter?: string | null,
  colour?: string | null,
  abilityBand?: string | null,
  pitchName?: string | null,
  teamBColour?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_event_group_appearance(
      groupId,
      candidOpt(teamLetter),
      candidOpt(colour),
      candidOpt(abilityBand),
      candidOpt(pitchName),
      candidOpt(teamBColour),
    ),
    "Set event group appearance",
  );
}

/**
 * Atomic batch replace of an event's groups (players + per-group duties in
 * one call) — counterpart of the Supabase replace_event_groups RPC used by
 * auto-generate and copy-from-previous-event group flows.
 */
export interface LiveGroupPlayerInput {
  accountId: string;
  teamLetter?: string | null;
}

export interface LiveGroupDutyInput {
  duty: string;
  accountId?: string | null;
}

export interface LiveGroupSpecInput {
  name: string;
  abilityBand?: string | null;
  pitchName?: string | null;
  displayOrder: number;
  teamAColour?: string | null;
  teamBColour?: string | null;
  players: LiveGroupPlayerInput[];
  duties: LiveGroupDutyInput[];
}

export async function replaceLiveEventGroups(
  ctx: FeatureBackendContext,
  eventId: string,
  groups: LiveGroupSpecInput[],
  deleteExisting: boolean,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.replace_event_groups(
      eventId,
      groups.map((g) => ({
        name: g.name,
        ability_band: candidOpt(g.abilityBand),
        pitch_name: candidOpt(g.pitchName),
        display_order: g.displayOrder,
        team_a_colour: candidOpt(g.teamAColour),
        team_b_colour: candidOpt(g.teamBColour),
        players: g.players.map((p) => ({
          account_id: p.accountId,
          team_letter: candidOpt(p.teamLetter),
        })),
        duties: g.duties.map((d) => ({
          duty: d.duty,
          account_id: candidOpt(d.accountId),
        })),
      })),
      deleteExisting,
    ),
    "Replace event groups",
  );
}

/** Flat duties list for an event (distinct from per-group duties above). */
export async function listLiveDuties(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_duties(eventId), "List duties");
}

/** The caller's own linked children (events-domain self-service roster). */
export async function getLiveMyChildren(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.my_children();
}

/** Admin upsert of a child->team assignment. */
export async function adminUpsertLiveChildTeamAssignment(
  ctx: FeatureBackendContext,
  childId: string,
  teamId: string,
  clubId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.admin_upsert_child_team_assignment(childId, teamId, clubId),
    "Assign child to team",
  );
}

export async function removeLiveChildTeamAssignment(
  ctx: FeatureBackendContext,
  childId: string,
  teamId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.remove_child_team_assignment(childId, teamId),
    "Remove child team assignment",
  );
}

export async function listLiveChildTeamAssignments(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_child_team_assignments(clubId, teamId),
    "List child team assignments",
  );
}

/** The caller's own child's team assignments, scoped by child id. */
export async function getLiveMyChildTeamAssignments(
  ctx: FeatureBackendContext,
  childId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.my_child_team_assignments(childId),
    "Get my child team assignments",
  );
}

// ============================================================================
// Workstream D: pitch board settings, game summary/stats, cross-sport game
// result, active-game mirror, admin event-view list / per-user viewed-ids,
// and event membership check.
// ============================================================================

export interface LivePitchBoardSettingsInput {
  teamId: string;
  rotationSpeed: number;
  disablePositionSwaps: boolean;
  disableBatchSubs: boolean;
  rotateGkAtHalftime: boolean;
  minutesPerHalf: number;
  maxSpreadMinutes: number;
  teamSize: number;
  formation?: string | null;
  showMatchHeader: boolean;
  showLineupPicker: boolean;
}

export async function getLivePitchBoardSettings(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_pitch_board_settings(teamId),
    "Get pitch board settings",
  );
}

export async function saveLivePitchBoardSettings(
  ctx: FeatureBackendContext,
  input: LivePitchBoardSettingsInput,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.save_pitch_board_settings(
      input.teamId,
      input.rotationSpeed,
      input.disablePositionSwaps,
      input.disableBatchSubs,
      input.rotateGkAtHalftime,
      input.minutesPerHalf,
      input.maxSpreadMinutes,
      input.teamSize,
      candidOpt(input.formation),
      input.showMatchHeader,
      input.showLineupPicker,
    ),
    "Save pitch board settings",
  );
}

export async function saveLiveGameSummary(
  ctx: FeatureBackendContext,
  input: {
    eventId: string;
    teamId: string;
    totalGameTime: number;
    halfDuration: number;
    formationUsed?: string | null;
    totalSubstitutions: number;
  },
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.save_game_summary(
      input.eventId,
      input.teamId,
      input.totalGameTime,
      input.halfDuration,
      candidOpt(input.formationUsed),
      input.totalSubstitutions,
    ),
    "Save game summary",
  );
}

export async function getLiveGameSummary(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_game_summary(eventId), "Get game summary");
}

export interface LiveGamePlayerStatInput {
  userId?: string | null;
  fillInPlayerName?: string | null;
  jerseyNumber?: number | null;
  minutesPlayed: number;
  positionsPlayed: string[];
  substitutionsCount: number;
  startedOnPitch: boolean;
  goalsScored: number;
}

export async function saveLiveGamePlayerStats(
  ctx: FeatureBackendContext,
  eventId: string,
  teamId: string,
  stats: LiveGamePlayerStatInput[],
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  // Fill-in names become opaque PII references before crossing to the
  // canister; plaintext never reaches events_domain.
  const withRefs = await Promise.all(
    stats.map(async (s) => ({
      ...s,
      fillInPlayerName: s.fillInPlayerName?.trim()
        ? await registerFillInNameRef(ctx, eventId, teamId, s.fillInPlayerName.trim())
        : s.fillInPlayerName ?? null,
    })),
  );
  return unwrapCandid(
    actor.save_game_player_stats(
      eventId,
      teamId,
      withRefs.map((s) => ({
        user_id: candidOpt(s.userId),
        fill_in_player_name: candidOpt(s.fillInPlayerName),
        jersey_number: candidOpt(s.jerseyNumber),
        minutes_played: s.minutesPlayed,
        positions_played: s.positionsPlayed,
        substitutions_count: s.substitutionsCount,
        started_on_pitch: s.startedOnPitch,
        goals_scored: s.goalsScored,
      })),
    ),
    "Save game player stats",
  );
}

export async function listLiveGamePlayerStats(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  const stats = unwrapCandid(actor.list_game_player_stats(eventId), "List game player stats") as unknown as Array<{
    fill_in_player_name: [] | [string];
    [key: string]: unknown;
  }>;
  // Fill-in names are opaque PII references on the canister; resolve them
  // best effort. An unreadable reference renders as a neutral label, never
  // an error state; legacy plaintext rows render as-is.
  const refs = stats
    .map((s) => (s.fill_in_player_name.length > 0 ? s.fill_in_player_name[0] : null))
    .filter((n): n is string => !!n && n.startsWith("fillin:"));
  const names = await resolveNameRefs(ctx, refs, "List game player stats");
  return stats.map((s) => {
    const raw = s.fill_in_player_name.length > 0 ? s.fill_in_player_name[0] : null;
    if (!raw || !raw.startsWith("fillin:")) return s;
    return { ...s, fill_in_player_name: [names.get(raw) ?? "Fill-in player"] as [string] };
  });
}

export interface LiveGameResultInput {
  teamId: string;
  eventId?: string | null;
  sport: string;
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  periodScoresJson: string;
  playerStatsJson: string;
  mvpPlayerId?: string | null;
  mvpPlayerName?: string | null;
}

// Player names embedded in the game-result stats JSON are PII: each name is
// registered on pii_access_control under an opaque reference and only the
// reference reaches events_domain. The club read grant lets club members
// decrypt the names when rendering history. All registration is best effort.
const STAT_NAME_REF_PREFIX = "statname:";
const PITCH_NAME_REF_PREFIX = "pitchname:";

async function registerJsonNameRefs(
  ctx: FeatureBackendContext,
  teamId: string,
  scope: string,
  prefix: string,
  entries: Array<{ key: string; name: string }>,
): Promise<Map<string, string>> {
  const clubId = clubIdFromTeamId(teamId);
  const refs = new Map<string, string>();
  await Promise.all(
    entries.map(async ({ key, name }) => {
      const ref = `${prefix}${scope}:${key}`;
      await registerLivePiiText(ctx, ref, "name", name);
      if (clubId) await grantLiveClubPiiRead(ctx, ref, "name", clubId);
      refs.set(key, ref);
    }),
  );
  return refs;
}

/** Replace `name` fields in a parsed JSON doc with opaque PII refs. */
function substituteNameRefs(doc: unknown, refs: Map<string, string>): unknown {
  if (!Array.isArray(doc)) return doc;
  return doc.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.name !== "string") return entry;
    const ref = refs.get(rec.id);
    return ref ? { ...rec, name: ref } : entry;
  });
}

/** Resolve opaque PII refs back to names in a parsed JSON doc, best effort. */
function resolveNameRefsInDoc(
  doc: unknown,
  prefix: string,
  names: Map<string, string>,
): unknown {
  if (!Array.isArray(doc)) return doc;
  return doc.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.name !== "string" || !rec.name.startsWith(prefix)) return entry;
    // An unreadable reference renders as a neutral label, never an error
    // state; legacy plaintext rows render as-is.
    return { ...rec, name: names.get(rec.name) ?? "Player" };
  });
}

export async function saveLiveGameResult(
  ctx: FeatureBackendContext,
  input: LiveGameResultInput,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  // The MVP name becomes an opaque PII reference before crossing to the
  // canister; plaintext never reaches events_domain.
  const mvpName = input.mvpPlayerName?.trim()
    ? await registerMvpNameRef(ctx, input, input.mvpPlayerName.trim())
    : input.mvpPlayerName ?? null;
  // Player names inside the stats JSON are masked the same way.
  let playerStatsJson = input.playerStatsJson;
  try {
    const stats = JSON.parse(input.playerStatsJson) as Array<{ id?: unknown; name?: unknown }>;
    if (Array.isArray(stats)) {
      const named = stats.filter(
        (s): s is { id: string; name: string } =>
          typeof s?.id === "string" && typeof s?.name === "string" && s.name.trim().length > 0,
      );
      if (named.length > 0) {
        const scope = input.eventId ?? `${input.teamId}:${crypto.randomUUID()}`;
        const refs = await registerJsonNameRefs(
          ctx,
          input.teamId,
          scope,
          STAT_NAME_REF_PREFIX,
          named.map((s) => ({ key: s.id, name: s.name.trim() })),
        );
        playerStatsJson = JSON.stringify(substituteNameRefs(stats, refs));
      }
    }
  } catch {
    // Non-JSON or unexpected shape: pass through untouched (legacy behavior).
  }
  return unwrapCandid(
    actor.save_game_result(
      input.teamId,
      candidOpt(input.eventId),
      input.sport,
      input.homeLabel,
      input.awayLabel,
      input.homeScore,
      input.awayScore,
      input.periodScoresJson,
      playerStatsJson,
      candidOpt(input.mvpPlayerId),
      candidOpt(mvpName),
    ),
    "Save game result",
  );
}

export async function getLiveGameResult(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  const result = unwrapCandid(actor.get_game_result(eventId), "Get game result") as unknown as
    | []
    | [{ mvp_player_name: [] | [string]; player_stats_json?: string; [key: string]: unknown }];
  if (result.length === 0) return result;
  const row = result[0];
  // MVP and per-player stat names are opaque PII references; resolve them
  // best effort. An unreadable reference renders as a neutral label, never
  // an error state; legacy plaintext rows render as-is.
  const refs: string[] = [];
  const rawMvp = row.mvp_player_name.length > 0 ? row.mvp_player_name[0] : null;
  if (rawMvp?.startsWith("mvp:")) refs.push(rawMvp);
  let statsDoc: unknown = null;
  if (typeof row.player_stats_json === "string") {
    try {
      statsDoc = JSON.parse(row.player_stats_json);
      if (Array.isArray(statsDoc)) {
        for (const entry of statsDoc) {
          const name = (entry as Record<string, unknown> | null)?.name;
          if (typeof name === "string" && name.startsWith(STAT_NAME_REF_PREFIX)) refs.push(name);
        }
      }
    } catch {
      statsDoc = null;
    }
  }
  if (refs.length === 0) return result;
  const names = await resolveNameRefs(ctx, refs, "Get game result");
  const next: Record<string, unknown> = { ...row };
  if (rawMvp?.startsWith("mvp:")) {
    next.mvp_player_name = [names.get(rawMvp) ?? "Player"] as [string];
  }
  if (statsDoc !== null) {
    next.player_stats_json = JSON.stringify(
      resolveNameRefsInDoc(statsDoc, STAT_NAME_REF_PREFIX, names),
    );
  }
  return [next];
}

// Pitch-state syncs fire every few seconds during a live game, so PII
// registration is cached per (ref, name): a player's name is only pushed to
// pii_access_control the first time it is seen (or when it changes), and the
// deterministic ref is reused on every subsequent sync.
const pitchNameRegistrations = new Map<string, string>();

export async function syncLiveActiveGame(
  ctx: FeatureBackendContext,
  input: {
    teamId?: string | null;
    timerStateJson: string;
    pitchStateJson: string;
    boardSessionId: string;
  },
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  // Player names embedded in the pitch-state JSON are PII: mask them with
  // opaque references before they cross to events_domain.
  let pitchStateJson = input.pitchStateJson;
  try {
    const doc = JSON.parse(input.pitchStateJson) as { players?: Array<{ id?: unknown; name?: unknown }> };
    const players = Array.isArray(doc?.players) ? doc.players : [];
    const named = players.filter(
      (p): p is { id: string; name: string } =>
        typeof p?.id === "string" && typeof p?.name === "string" && p.name.trim().length > 0,
    );
    if (named.length > 0 && input.teamId) {
      const clubId = clubIdFromTeamId(input.teamId);
      const refs = new Map<string, string>();
      await Promise.all(
        named.map(async (p) => {
          const ref = `${PITCH_NAME_REF_PREFIX}${input.teamId}:${p.id}`;
          if (pitchNameRegistrations.get(ref) !== p.name.trim()) {
            await registerLivePiiText(ctx, ref, "name", p.name.trim());
            if (clubId) await grantLiveClubPiiRead(ctx, ref, "name", clubId);
            pitchNameRegistrations.set(ref, p.name.trim());
          }
          refs.set(p.id, ref);
        }),
      );
      pitchStateJson = JSON.stringify({ ...doc, players: substituteNameRefs(players, refs) });
    }
  } catch {
    // Non-JSON or unexpected shape: pass through untouched (legacy behavior).
  }
  return unwrapCandid(
    actor.sync_active_game(
      candidOpt(input.teamId),
      input.timerStateJson,
      pitchStateJson,
      input.boardSessionId,
    ),
    "Sync active game",
  );
}

export async function deactivateLiveActiveGame(
  ctx: FeatureBackendContext,
  teamId?: string | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.deactivate_active_game(candidOpt(teamId)), "Deactivate active game");
}

export async function getLiveActiveGame(ctx: FeatureBackendContext, teamId?: string | null) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  const result = unwrapCandid(actor.get_active_game(candidOpt(teamId)), "Get active game") as unknown as
    | []
    | [{ pitch_state_json?: string; [key: string]: unknown }];
  if (result.length === 0) return result;
  const row = result[0];
  // Player names inside the pitch-state JSON are opaque PII references;
  // resolve them best effort (neutral label when unreadable; legacy
  // plaintext renders as-is).
  if (typeof row.pitch_state_json !== "string") return result;
  let doc: unknown;
  try {
    doc = JSON.parse(row.pitch_state_json);
  } catch {
    return result;
  }
  const players = (doc as { players?: unknown[] } | null)?.players;
  if (!Array.isArray(players)) return result;
  const refs = players
    .map((p) => (p as Record<string, unknown> | null)?.name)
    .filter((n): n is string => typeof n === "string" && n.startsWith(PITCH_NAME_REF_PREFIX));
  if (refs.length === 0) return result;
  const names = await resolveNameRefs(ctx, refs, "Get active game");
  const resolved = {
    ...(doc as Record<string, unknown>),
    players: resolveNameRefsInDoc(players, PITCH_NAME_REF_PREFIX, names),
  };
  return [{ ...row, pitch_state_json: JSON.stringify(resolved) }];
}

/** Admin per-viewer event-view list (event_views rows for one event). */
export async function listLiveEventViews(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_event_views(eventId), "List event views");
}

/** Which of the given event ids the caller has already viewed. */
export async function listLiveMyViewedEventIds(
  ctx: FeatureBackendContext,
  eventIds: string[],
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_my_viewed_event_ids(eventIds),
    "List my viewed event ids",
  );
}

/**
 * Whether `userId` is a member of the audience for `eventId`, evaluated
 * against events_domain's own roster/rsvp/attendance/duty rows. Plain query
 * result (returns a bare bool, no Ok/Err variant).
 */
export async function checkLiveEventMembership(
  ctx: FeatureBackendContext,
  userId: string,
  eventId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return actor.check_event_membership(userId, eventId);
}

// ============================================================================
// PlayHQ reads (Phase 4): club-level API credentials + read-only
// competition/fixture lookups now live on events_domain. Import and
// materialise-into-events stay Supabase-only (no canister counterpart) —
// only these reads move.
// ============================================================================

export interface LivePlayHQConfigInput {
  baseUrl: string;
  apiKey: string;
}

/** Admin-only: stores the club's PlayHQ API credentials on events_domain. */
export async function setLivePlayHQConfig(
  ctx: FeatureBackendContext,
  config: LivePlayHQConfigInput | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_playhq_config(
      candidOpt(
        config
          ? {
              base_url: config.baseUrl,
              api_key: config.apiKey,
              updated_at_ms: toNat64(Date.now()),
            }
          : null,
      ),
    ),
    "Set PlayHQ config",
  );
}

/** PlayHQ competitions visible to the caller's club (tenant/org scoped). */
export async function listLivePlayHQCompetitions(
  ctx: FeatureBackendContext,
  tenant: string,
  orgId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_playhq_competitions(tenant, orgId),
    "List PlayHQ competitions",
  );
}

/** PlayHQ fixtures (matches) for one competition. */
export async function listLivePlayHQFixtures(
  ctx: FeatureBackendContext,
  competitionId: string,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_playhq_fixtures(competitionId),
    "List PlayHQ fixtures",
  );
}

/** Cancel/reinstate every remaining occurrence of a series in one call. */
export async function setLiveSeriesCancelled(
  ctx: FeatureBackendContext,
  seriesId: string,
  cancelled: boolean,
  fromMs: number | Date,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_series_cancelled(seriesId, cancelled, toNat64(fromMs)),
    cancelled ? "Cancel series" : "Reinstate series",
  );
}

/** Scheduled RSVP reminder: hours before start, or null to turn it off. */
export async function setLiveEventAutoReminder(
  ctx: FeatureBackendContext,
  eventId: string,
  hoursBefore: number | null,
) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_event_auto_reminder(eventId, hoursBefore == null ? [] : [Math.round(hoursBefore)]),
    "Set auto reminder",
  );
}

export async function getLiveEventAutoReminder(ctx: FeatureBackendContext, eventId: string) {
  const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
  const result = await actor.get_event_auto_reminder(eventId);
  return result[0] ?? null;
}
