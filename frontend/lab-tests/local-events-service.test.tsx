import { expect, test, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import {
  createEventsDomainClient,
  validateEventTeamClubScope,
} from '../src/lab/localEventsService';
import type { _SERVICE } from '../src/lab/bindings/events_domain/declarations/events_domain.did';

test('events domain client maps exported local RSVPs into page rows', async () => {
  const client = createEventsDomainClient({
    export_state: vi.fn(async () => ({
      Ok: {
        schema: 1,
        governor: Principal.fromText('aaaaa-aa'),
        events: [],
        rsvps: [{ event_id: 'event-1', account_id: 'account-1', state: 'going', updated_at_ms: 2n }],
        attendance: [{ event_id: 'event-1', account_id: 'account-1', present: true, note: 'Checked in' }],
        duties: [],
        recurrences: [],
        roster: [],
        lineups: [],
        roles: [],
      },
    })),
  } as unknown as _SERVICE);

  await expect(client.listEventRsvps('event-1')).resolves.toMatchObject([
    { event_id: 'event-1', user_id: 'account-1', status: 'going', notes: 'Present: Checked in', source: 'icp' },
  ]);
});

test('events domain client exposes exported state for attendance projections', async () => {
  const exportState = vi.fn(async () => ({
    Ok: {
      schema: 1,
      governor: Principal.fromText('aaaaa-aa'),
      events: [],
      rsvps: [],
      attendance: [{ event_id: 'event-1', account_id: 'account-1', present: true, note: 'Checked in' }],
      duties: [],
      recurrences: [],
      roster: [],
      lineups: [],
      roles: [],
    },
  }));
  const client = createEventsDomainClient({ export_state: exportState } as unknown as _SERVICE);

  await expect(client.exportState()).resolves.toMatchObject({
    attendance: [{ event_id: 'event-1', account_id: 'account-1', present: true }],
  });
  expect(exportState).toHaveBeenCalledOnce();
});

test('events domain client maps scoped canister events into schedule rows', async () => {
  const listEvents = vi.fn(async () => [{
    id: 'event-1',
    title: 'Training night',
    creator: Principal.fromText('2ibo7-dia'),
    team_id: ['team-1'],
    description: 'Synthetic training',
    starts_at_ms: BigInt(Date.UTC(2026, 0, 2, 18, 0, 0)),
    ends_at_ms: BigInt(Date.UTC(2026, 0, 2, 19, 0, 0)),
    revision: 1n,
    club_id: 'club-1',
  }]);
  const client = createEventsDomainClient({ list_events: listEvents } as unknown as _SERVICE);

  await expect(client.listEvents('club-1', 'team-1')).resolves.toMatchObject([
    expect.objectContaining({
      id: 'event-1',
      title: 'Training night',
      type: 'training',
      event_date: '2026-01-02T18:00:00.000Z',
      club_id: 'club-1',
      team_id: 'team-1',
      location_name: 'Local ICP canister',
    }),
  ]);
  expect(listEvents).toHaveBeenCalledWith(['club-1'], ['team-1']);
});

test('events domain client surfaces create failures and maps accepted writes', async () => {
  const createEvent = vi
    .fn()
    .mockResolvedValueOnce({ Err: 'Club or team admin required' })
    .mockResolvedValueOnce({
      Ok: {
        id: 'event-2',
        title: 'Match day',
        creator: Principal.fromText('2ibo7-dia'),
        team_id: [],
        description: 'Synthetic match',
        starts_at_ms: BigInt(Date.UTC(2026, 0, 3, 12, 0, 0)),
        ends_at_ms: BigInt(Date.UTC(2026, 0, 3, 13, 0, 0)),
        revision: 1n,
        club_id: 'club-1',
      },
    });
  const client = createEventsDomainClient({
    list_events: vi.fn(),
    create_event: createEvent,
  } as unknown as _SERVICE);

  await expect(client.createEvent('club-1', null, 'No role', 'No role', 1n, 2n)).rejects.toThrow('Club or team admin required');
  await expect(client.createEvent('club-1', null, 'Match day', 'Synthetic match', 1n, 2n)).resolves.toMatchObject({
    id: 'event-2',
    type: 'game',
    team_id: null,
  });
  expect(createEvent).toHaveBeenLastCalledWith('club-1', [], 'Match day', 'Synthetic match', 1n, 2n);
});

test('events domain client rejects an unavailable team scope before the ICP call', async () => {
  const createEvent = vi.fn();
  const client = createEventsDomainClient({
    create_event: createEvent,
  } as unknown as _SERVICE);

  await expect(client.createEvent(
    'club-1',
    'team-missing',
    'Scoped event',
    'Synthetic details',
    1n,
    2n,
    { teamScope: [] },
  )).rejects.toThrow('Event team scope rejected: list_unavailable');
  expect(createEvent).not.toHaveBeenCalled();
});

test('event team scope guard allows club-wide and same-club events only', () => {
  const teams = [{ id: 'team-1', clubId: 'club-1' }];

  expect(validateEventTeamClubScope(null, teams, 'club-1')).toEqual({ ok: true });
  expect(validateEventTeamClubScope('team-1', teams, 'club-1')).toEqual({ ok: true });
  expect(validateEventTeamClubScope('missing', teams, 'club-1')).toEqual({
    ok: false,
    reason: 'team_not_in_club',
  });
  expect(validateEventTeamClubScope('team-1', undefined, 'club-1')).toEqual({
    ok: false,
    reason: 'list_unavailable',
  });
});

test('events domain client gets and updates events without fallback semantics', async () => {
  const stored = {
    id: 'event-3',
    title: 'Existing game',
    creator: Principal.fromText('2ibo7-dia'),
    team_id: ['team-1'],
    description: 'Existing description',
    starts_at_ms: BigInt(Date.UTC(2026, 0, 4, 10, 0, 0)),
    ends_at_ms: BigInt(Date.UTC(2026, 0, 4, 11, 0, 0)),
    revision: 1n,
    club_id: 'club-1',
  };
  const updateEvent = vi.fn(async () => ({
    Ok: {
      ...stored,
      title: 'Updated game',
      description: 'Updated description',
      starts_at_ms: 3n,
      ends_at_ms: 4n,
      revision: 2n,
    },
  }));
  const client = createEventsDomainClient({
    list_events: vi.fn(async () => [stored]),
    create_event: vi.fn(),
    update_event: updateEvent,
  } as unknown as _SERVICE);

  await expect(client.getEvent('event-3')).resolves.toMatchObject({ id: 'event-3', title: 'Existing game' });
  await expect(client.getEvent('missing')).rejects.toThrow('Event not found');
  await expect(client.updateEvent('event-3', 'Updated game', 'Updated description', 3n, 4n)).resolves.toMatchObject({
    title: 'Updated game',
    description: 'Updated description',
  });
  expect(updateEvent).toHaveBeenCalledWith('event-3', 'Updated game', 'Updated description', 3n, 4n);
});

test('events domain client writes RSVP, attendance, and assigned duty decisions', async () => {
  const setRsvp = vi.fn(async () => ({
    Ok: {
      event_id: 'event-4',
      account_id: 'account-1',
      state: 'going',
      updated_at_ms: 5n,
    },
  }));
  const setAttendance = vi.fn(async () => ({
    Ok: {
      event_id: 'event-4',
      account_id: 'account-1',
      present: true,
      note: 'Checked in',
    },
  }));
  const setDuty = vi.fn(async () => ({
    Ok: {
      event_id: 'event-4',
      account_id: 'account-1',
      duty: 'Linesperson',
    },
  }));
  const setRecurrence = vi.fn(async () => ({
    Ok: { event_id: 'event-4', frequency: 'weekly', until_ms: 20n },
  }));
  const client = createEventsDomainClient({
    list_events: vi.fn(),
    create_event: vi.fn(),
    update_event: vi.fn(),
    set_rsvp: setRsvp,
    set_attendance: setAttendance,
    set_duty: setDuty,
    set_recurrence: setRecurrence,
  } as unknown as _SERVICE);

  await expect(client.setRsvp('event-4', 'account-1', 'going')).resolves.toMatchObject({
    event_id: 'event-4',
    account_id: 'account-1',
    state: 'going',
  });
  await expect(client.setAttendance('event-4', 'account-1', true, 'Checked in')).resolves.toMatchObject({
    event_id: 'event-4',
    account_id: 'account-1',
    present: true,
    note: 'Checked in',
  });
  await expect(client.setDuty('event-4', 'account-1', 'Linesperson')).resolves.toMatchObject({
    event_id: 'event-4',
    account_id: 'account-1',
    duty: 'Linesperson',
  });
  await expect(client.setRecurrence('event-4', 'weekly', 20n)).resolves.toMatchObject({
    event_id: 'event-4',
    frequency: 'weekly',
  });
  expect(setRecurrence).toHaveBeenCalledWith('event-4', 'weekly', 20n);
  expect(setRsvp).toHaveBeenCalledWith('event-4', 'account-1', 'going');
  expect(setAttendance).toHaveBeenCalledWith('event-4', 'account-1', true, 'Checked in');
  expect(setDuty).toHaveBeenCalledWith('event-4', 'account-1', 'Linesperson');
});
