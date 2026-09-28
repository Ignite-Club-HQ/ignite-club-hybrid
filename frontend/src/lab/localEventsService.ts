import { idlFactory } from './bindings/events_domain/declarations/events_domain.did.js';
import type { Attendance, Duty, Event as IcpEvent, Recurrence, Rsvp, _SERVICE } from './bindings/events_domain/declarations/events_domain.did.js';
import { connectLocalDomainActor } from './localActor';

export interface LocalScheduleEvent {
  id: string;
  title: string;
  type: 'game' | 'training' | 'social';
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  location_name: string | null;
  club_id: string;
  team_id: string | null;
  mini_league_id: string | null;
  is_cancelled: boolean;
  is_bye: boolean | null;
  is_recurring: boolean;
  parent_event_id: string | null;
  opponent: string | null;
  teams: { name: string } | null;
  clubs: { name: string; sport: string | null; is_pro: boolean };
  description: string;
  created_by: string;
  updated_at: string;
  target_team_ids: string[] | null;
  arrival_minutes_before: number | null;
  rsvp_audience: string | null;
  adults_only: boolean | null;
  starts_at_ms: bigint;
  ends_at_ms: bigint;
}

export interface LocalEventRsvp {
  id: string;
  event_id: string;
  user_id: string;
  child_id: null;
  mini_league_player_id?: string | null;
  status: string;
  notes: string | null;
  source: 'icp';
  profiles: { display_name: string; avatar_url: null };
  children: null;
}

export type EventScopeCheck =
  | { ok: true }
  | { ok: false; reason: 'list_unavailable' | 'team_not_in_club' };

export interface TeamScopeShape {
  id: string;
  clubId: string;
}

type EventsState = Extract<
  Awaited<ReturnType<_SERVICE['export_state']>>,
  { Ok: unknown }
>['Ok'];

/**
 * Validate a selected event team before the provider call.
 *
 * This is intentionally provider-neutral: the same guard can run before
 * either explicit Supabase or ICP routing, while the selected provider still
 * owns authoritative authorization.
 */
export function validateEventTeamClubScope(
  teamId: string | null | undefined,
  teams: TeamScopeShape[] | null | undefined,
  clubId: string | null | undefined,
): EventScopeCheck {
  if (!teamId) return { ok: true };
  if (!teams || teams.length === 0) return { ok: false, reason: 'list_unavailable' };

  const selected = teams.find(team => team.id === teamId);
  if (!selected || selected.clubId !== clubId) {
    return { ok: false, reason: 'team_not_in_club' };
  }

  return { ok: true };
}

function titleToType(title: string): LocalScheduleEvent['type'] {
  const normalized = title.toLowerCase();
  if (normalized.includes('training')) return 'training';
  if (normalized.includes('social')) return 'social';
  return 'game';
}

function convertEvent(event: IcpEvent): LocalScheduleEvent {
  const start = new Date(Number(event.starts_at_ms));
  return {
    id: event.id,
    title: event.title,
    type: titleToType(event.title),
    event_date: Number.isFinite(start.getTime()) ? start.toISOString() : new Date(0).toISOString(),
    start_time: Number.isFinite(start.getTime()) ? start.toISOString().slice(11, 16) : null,
    end_time: Number.isFinite(Number(event.ends_at_ms)) ? new Date(Number(event.ends_at_ms)).toISOString().slice(11, 16) : null,
    address: null,
    suburb: null,
    state: null,
    postcode: null,
    location_name: 'Local ICP canister',
    club_id: event.club_id,
    team_id: event.team_id[0] ?? null,
    mini_league_id: null,
    is_cancelled: false,
    is_bye: false,
    is_recurring: false,
    parent_event_id: null,
    opponent: null,
    teams: event.team_id.length ? { name: 'ICP team' } : null,
    clubs: { name: 'ICP club', sport: null, is_pro: false },
    description: event.description,
    created_by: event.creator.toText(),
    updated_at: new Date(0).toISOString(),
    target_team_ids: null,
    arrival_minutes_before: null,
    rsvp_audience: null,
    adults_only: false,
    starts_at_ms: event.starts_at_ms,
    ends_at_ms: event.ends_at_ms,
  };
}

export function isLocalEventsCanisterUnavailable(error: unknown): boolean {
  return error instanceof Error && /events domain canister is not configured/i.test(error.message);
}

export function createEventsDomainClient(actor: Pick<_SERVICE, 'list_events' | 'create_event' | 'update_event' | 'set_rsvp' | 'set_attendance' | 'set_duty' | 'set_recurrence' | 'export_state'>) {
  return {
    async listEvents(clubId?: string | null, teamId?: string | null): Promise<LocalScheduleEvent[]> {
      const events = await actor.list_events(clubId ? [clubId] : [], teamId ? [teamId] : []);
      return events.map(convertEvent);
    },
    async createEvent(
      clubId: string,
      teamId: string | null,
      title: string,
      description: string,
      startsAtMs: bigint,
      endsAtMs: bigint,
      options?: { teamScope: TeamScopeShape[] | null | undefined },
    ): Promise<LocalScheduleEvent> {
      if (options) {
        const scope = validateEventTeamClubScope(teamId, options.teamScope, clubId);
        if (scope.ok === false) throw new Error(`Event team scope rejected: ${scope.reason}`);
      }
      const result = await actor.create_event(clubId, teamId ? [teamId] : [], title, description, startsAtMs, endsAtMs);
      if ('Err' in result) throw new Error(result.Err);
      return convertEvent(result.Ok);
    },
    async getEvent(id: string): Promise<LocalScheduleEvent> {
      const events = await actor.list_events([], []);
      const event = events.find((candidate) => candidate.id === id);
      if (!event) throw new Error('Event not found');
      return convertEvent(event);
    },
    async updateEvent(
      id: string,
      title: string,
      description: string,
      startsAtMs: bigint,
      endsAtMs: bigint,
    ): Promise<LocalScheduleEvent> {
      const result = await actor.update_event(id, title, description, startsAtMs, endsAtMs);
      if ('Err' in result) throw new Error(result.Err);
      return convertEvent(result.Ok);
    },
    async setRsvp(eventId: string, accountId: string, state: string): Promise<Rsvp> {
      const result = await actor.set_rsvp(eventId, accountId, state);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async setAttendance(eventId: string, accountId: string, present: boolean, note: string): Promise<Attendance> {
      const result = await actor.set_attendance(eventId, accountId, present, note);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async setDuty(eventId: string, accountId: string, duty: string): Promise<Duty> {
      const result = await actor.set_duty(eventId, accountId, duty);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async setRecurrence(eventId: string, frequency: string, untilMs: bigint): Promise<Recurrence> {
      const result = await actor.set_recurrence(eventId, frequency, untilMs);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async listEventRsvps(eventId: string): Promise<LocalEventRsvp[]> {
      const result = await actor.export_state();
      if ('Err' in result) throw new Error(result.Err);
      const attendanceByAccount = new Map(
        result.Ok.attendance
          .filter((attendance) => attendance.event_id === eventId)
          .map((attendance) => [attendance.account_id, attendance]),
      );
      return result.Ok.rsvps
        .filter((rsvp) => rsvp.event_id === eventId)
        .map((rsvp) => {
          const attendance = attendanceByAccount.get(rsvp.account_id);
          const attendanceNote = attendance
            ? `${attendance.present ? 'Present' : 'Absent'}${attendance.note ? `: ${attendance.note}` : ''}`
            : null;
          return {
            id: `local-rsvp-${eventId}-${rsvp.account_id}`,
            event_id: eventId,
            user_id: rsvp.account_id,
            child_id: null,
            status: rsvp.state,
            notes: attendanceNote,
            source: 'icp' as const,
            profiles: { display_name: rsvp.account_id, avatar_url: null },
            children: null,
          };
        });
    },
    async exportState(): Promise<EventsState> {
      const result = await actor.export_state();
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
  };
}

async function connectEventsActor(persona: string): Promise<_SERVICE> {
  return connectLocalDomainActor<_SERVICE>(persona, 'events_domain', 'events', idlFactory);
}

export async function listLocalEvents(persona: string, clubId?: string | null, teamId?: string | null): Promise<LocalScheduleEvent[]> {
  return createEventsDomainClient(await connectEventsActor(persona)).listEvents(clubId, teamId);
}

export async function createLocalEvent(
  persona: string,
  clubId: string,
  teamId: string | null,
  title: string,
  description: string,
  startsAtMs: bigint,
  endsAtMs: bigint,
  options?: { teamScope: TeamScopeShape[] | null | undefined },
): Promise<LocalScheduleEvent> {
  return createEventsDomainClient(await connectEventsActor(persona)).createEvent(
    clubId,
    teamId,
    title,
    description,
    startsAtMs,
    endsAtMs,
    options,
  );
}

export async function getLocalEvent(persona: string, id: string): Promise<LocalScheduleEvent> {
  return createEventsDomainClient(await connectEventsActor(persona)).getEvent(id);
}

export async function updateLocalEvent(
  persona: string,
  id: string,
  title: string,
  description: string,
  startsAtMs: bigint,
  endsAtMs: bigint,
): Promise<LocalScheduleEvent> {
  return createEventsDomainClient(await connectEventsActor(persona)).updateEvent(id, title, description, startsAtMs, endsAtMs);
}

export async function setLocalEventRsvp(persona: string, eventId: string, accountId: string, state: string): Promise<Rsvp> {
  return createEventsDomainClient(await connectEventsActor(persona)).setRsvp(eventId, accountId, state);
}

export async function setLocalEventAttendance(
  persona: string,
  eventId: string,
  accountId: string,
  present: boolean,
  note: string,
): Promise<Attendance> {
  return createEventsDomainClient(await connectEventsActor(persona)).setAttendance(eventId, accountId, present, note);
}

export async function setLocalEventDuty(persona: string, eventId: string, accountId: string, duty: string): Promise<Duty> {
  return createEventsDomainClient(await connectEventsActor(persona)).setDuty(eventId, accountId, duty);
}

export async function setLocalEventRecurrence(
  persona: string,
  eventId: string,
  frequency: string,
  untilMs: bigint,
): Promise<Recurrence> {
  return createEventsDomainClient(await connectEventsActor(persona)).setRecurrence(eventId, frequency, untilMs);
}

export async function listLocalEventRsvps(persona: string, eventId: string): Promise<LocalEventRsvp[]> {
  return createEventsDomainClient(await connectEventsActor(persona)).listEventRsvps(eventId);
}

export async function exportLocalEventsState(persona: string): Promise<EventsState> {
  return createEventsDomainClient(await connectEventsActor(persona)).exportState();
}
