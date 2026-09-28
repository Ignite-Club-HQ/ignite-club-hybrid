import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, test } from 'vitest';
import {
  resolveClubBackend,
  type BackendProviders,
} from '../src/lab/backendRouter';
import type { PlacementRegistry } from '../src/lab/hybridClubLinksService';
import { validateEventTeamClubScope } from '../src/lab/localEventsService';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

type EventRecord = {
  id: string;
  clubId: string;
  teamId: string | null;
  title: string;
  description: string;
  cancelled: boolean;
  rsvps: Map<string, 'going' | 'maybe'>;
};

type EventActor = {
  id: string;
  clubId: string;
  admin: boolean;
};

type EventClient = {
  create(actor: EventActor, title: string, description: string, teamId?: string | null): Promise<EventRecord>;
  get(actor: EventActor, eventId: string): Promise<EventRecord | undefined>;
  rsvp(actor: EventActor, eventId: string, status: 'going' | 'maybe'): Promise<void>;
  update(actor: EventActor, eventId: string, title: string, description: string): Promise<void>;
  cancel(actor: EventActor, eventId: string): Promise<void>;
};

const CLUB_A = 'club-event-a';
const CLUB_B = 'club-event-b';
const ADMIN_A: EventActor = { id: 'event-admin-a', clubId: CLUB_A, admin: true };
const MEMBER_A: EventActor = { id: 'event-member-a', clubId: CLUB_A, admin: false };
const OUTSIDER_B: EventActor = { id: 'event-outsider-b', clubId: CLUB_B, admin: true };
const EVENT_TEAMS = [
  { id: 'event-team-a', clubId: CLUB_A },
  { id: 'event-team-b', clubId: CLUB_B },
];

function createEventClient(): EventClient {
  const events = new Map<string, EventRecord>();
  return {
    async create(actor, title, description, teamId = null) {
      if (!actor.admin) throw new Error('Club or team admin required');
      const scope = validateEventTeamClubScope(teamId, EVENT_TEAMS, actor.clubId);
      if (!scope.ok) throw new Error(`Event team scope rejected: ${scope.reason}`);
      const event = {
        id: `event-${events.size + 1}`,
        clubId: actor.clubId,
        teamId,
        title,
        description,
        cancelled: false,
        rsvps: new Map<string, 'going' | 'maybe'>(),
      };
      events.set(event.id, event);
      return event;
    },
    async get(actor, eventId) {
      const event = events.get(eventId);
      return event && event.clubId === actor.clubId ? event : undefined;
    },
    async rsvp(actor, eventId, status) {
      const event = events.get(eventId);
      if (!event || event.clubId !== actor.clubId) throw new Error('Event unavailable');
      event.rsvps.set(actor.id, status);
    },
    async update(actor, eventId, title, description) {
      const event = events.get(eventId);
      if (!event || event.clubId !== actor.clubId || !actor.admin) return;
      event.title = title;
      event.description = description;
    },
    async cancel(actor, eventId) {
      const event = events.get(eventId);
      if (!event || event.clubId !== actor.clubId || !actor.admin) return;
      event.cancelled = true;
    },
  };
}

async function routedClient(
  registry: PlacementRegistry,
  providers: BackendProviders<EventClient>,
  clients: Map<string, EventClient>,
  clubId: string,
) {
  const routed = await resolveClubBackend(registry, clubId);
  const key = routed.kind === 'icp'
    ? `icp:${routed.backend.Icp.canister.toText()}`
    : `supabase:${routed.backend.Supabase.environment}`;
  let client = clients.get(key);
  if (!client) {
    client = routed.kind === 'icp'
      ? await providers.icp(routed.backend.Icp.canister)
      : await providers.supabase(routed.backend.Supabase.environment);
    clients.set(key, client);
  }
  return client;
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`preserves event lifecycle semantics in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'events-au' } }
          : { Icp: { canister: Principal.fromText('aaaaa-aa') } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'events-us' } }
          : { Icp: { canister: Principal.fromText('2vxsx-fae') } },
      },
    ]);
    const calls: string[] = [];
    const clients = new Map<string, EventClient>();
    const getClient = (key: string) => {
      let client = clients.get(key);
      if (!client) {
        client = createEventClient();
        clients.set(key, client);
      }
      return client;
    };
    const providers: BackendProviders<EventClient> = {
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return getClient(`supabase:${environment}`);
      },
      icp: async canister => {
        calls.push(`icp:${canister.toText()}`);
        return getClient(`icp:${canister.toText()}`);
      },
    };
    const client = await routedClient(registry, providers, clients, CLUB_A);
    const crossClubClient = await routedClient(registry, providers, clients, CLUB_B);

    await expect(client.create(MEMBER_A, 'Unauthorized event', 'No access'))
      .rejects.toThrow('Club or team admin required');
    await expect(client.create(ADMIN_A, 'Cross-club event', 'Must reject', 'event-team-b'))
      .rejects.toThrow('Event team scope rejected: team_not_in_club');
    const event = await client.create(ADMIN_A, 'Synthetic training', 'Initial details', 'event-team-a');
    await expect(crossClubClient.get(OUTSIDER_B, event.id)).resolves.toBeUndefined();

    await client.rsvp(MEMBER_A, event.id, 'going');
    await expect(crossClubClient.rsvp(OUTSIDER_B, event.id, 'going'))
      .rejects.toThrow('Event unavailable');
    await client.update(MEMBER_A, event.id, 'Member must not edit', 'Unchanged');
    await expect(client.get(ADMIN_A, event.id)).resolves.toMatchObject({
      title: 'Synthetic training',
      description: 'Initial details',
      cancelled: false,
      rsvps: new Map([[MEMBER_A.id, 'going']]),
    });

    await client.update(ADMIN_A, event.id, 'Synthetic updated training', 'Updated details');
    await client.cancel(ADMIN_A, event.id);
    await expect(client.get(ADMIN_A, event.id)).resolves.toMatchObject({
      title: 'Synthetic updated training',
      description: 'Updated details',
      cancelled: true,
    });
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(mode === 'supabase' ? 'supabase:' : 'icp:'))).toBe(true);
  });
}

test('does not fall back to Supabase when the selected ICP event provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } },
  }]);
  const providers: BackendProviders<EventClient> = {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP event provider unavailable');
    },
  };

  await expect(routedClient(registry, providers, new Map(), CLUB_A))
    .rejects.toThrow('local ICP event provider unavailable');
  expect(supabaseCalls).toBe(0);
});

// Synthetic local equivalent of the exported Postgres/RLS journey test
// `local journey: event lifecycle and attendance permissions` (the real
// fixture-backed RLS journey requires a live local Supabase/Postgres
// instance, out of scope for this lab). Reuses the in-memory EventClient
// model above to enforce the same club-boundary and role contract.
describe('local journey: event lifecycle and attendance permissions', () => {
  test('protects creation, attendance, editing and cancellation across club boundaries', async () => {
    const client = createEventClient();

    await expect(client.create(MEMBER_A, 'Synthetic Unauthorized Event', 'x', 'event-team-a'))
      .rejects.toThrow('Club or team admin required');

    const created = await client.create(
      ADMIN_A,
      'Synthetic Lifecycle Training',
      'Initial details',
      'event-team-a',
    );
    expect(created).toMatchObject({ title: 'Synthetic Lifecycle Training', cancelled: false });
    const eventId = created.id;

    const memberView = await client.get(MEMBER_A, eventId);
    expect(memberView?.title).toBe('Synthetic Lifecycle Training');
    const outsiderView = await client.get(OUTSIDER_B, eventId);
    expect(outsiderView).toBeUndefined();

    await client.rsvp(MEMBER_A, eventId, 'going');
    expect((await client.get(ADMIN_A, eventId))?.rsvps.get(MEMBER_A.id)).toBe('going');

    await expect(client.rsvp(OUTSIDER_B, eventId, 'going')).rejects.toThrow('Event unavailable');

    await client.update(MEMBER_A, eventId, 'Member must not edit', 'x');
    expect((await client.get(ADMIN_A, eventId))?.title).toBe('Synthetic Lifecycle Training');

    await client.update(OUTSIDER_B, eventId, 'Outsider must not edit', 'x');
    expect((await client.get(ADMIN_A, eventId))?.title).toBe('Synthetic Lifecycle Training');

    await client.update(ADMIN_A, eventId, 'Synthetic Updated Training', 'Updated details');
    const edited = await client.get(ADMIN_A, eventId);
    expect(edited).toMatchObject({ title: 'Synthetic Updated Training', description: 'Updated details' });

    await client.rsvp(MEMBER_A, eventId, 'maybe');
    expect((await client.get(ADMIN_A, eventId))?.rsvps.get(MEMBER_A.id)).toBe('maybe');

    await client.cancel(ADMIN_A, eventId);
    const cancelledMemberView = await client.get(MEMBER_A, eventId);
    expect(cancelledMemberView).toMatchObject({
      title: 'Synthetic Updated Training',
      cancelled: true,
    });

    expect((await client.get(ADMIN_A, eventId))?.rsvps.get(MEMBER_A.id)).toBe('maybe');
  });
});
