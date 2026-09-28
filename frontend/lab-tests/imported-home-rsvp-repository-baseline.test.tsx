import { Principal } from '@icp-sdk/core/principal';
import { expect, test, vi } from 'vitest';
import {
  createHybridHomeRsvpRepository,
  fetchHomeUserRsvpsForClub,
  type HomeRsvpProvider,
  type HomeUserRsvp,
} from '../src/lab/hybridHomeRsvpRepository';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-home-rsvp-a';
const CLUB_B = 'club-home-rsvp-b';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

function makeProvider(rows: HomeUserRsvp[]): HomeRsvpProvider {
  return { listUserRsvps: async () => rows };
}

// Pure-function contract for one club's slice: provider-neutral because it
// only decides whether to call the provider or short-circuit.

test('fetchHomeUserRsvpsForClub does not call the provider when Home has no visible events for that club', async () => {
  const listUserRsvps = vi.fn().mockResolvedValue([]);
  await expect(fetchHomeUserRsvpsForClub({ listUserRsvps }, 'user-1', [])).resolves.toEqual([]);
  expect(listUserRsvps).not.toHaveBeenCalled();
});

test('fetchHomeUserRsvpsForClub reads only the current adult user rsvps for the visible event ids', async () => {
  const rows: HomeUserRsvp[] = [
    { event_id: 'event-1', status: 'going' },
    { event_id: 'event-2', status: 'maybe' },
  ];
  const listUserRsvps = vi.fn().mockResolvedValue(rows);
  await expect(
    fetchHomeUserRsvpsForClub({ listUserRsvps }, 'user-1', ['event-1', 'event-2']),
  ).resolves.toEqual(rows);
  expect(listUserRsvps).toHaveBeenCalledWith('user-1', ['event-1', 'event-2']);
});

test('fetchHomeUserRsvpsForClub propagates the provider failure', async () => {
  const denied = new Error('rsvps denied');
  await expect(
    fetchHomeUserRsvpsForClub({ listUserRsvps: async () => { throw denied; } }, 'user-1', ['event-1']),
  ).rejects.toBe(denied);
});

for (const mode of ['supabase', 'icp'] as const) {
  test(`aggregates one club's RSVP rows and reuses the provider in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase' ? { Supabase: { environment: 'home-rsvp-au' } } : { Icp: { canister: ICP_A } },
    }]);
    const rows: HomeUserRsvp[] = [{ event_id: 'event-1', status: 'going' }];
    const provider = makeProvider(rows);
    const providerCalls: string[] = [];
    const repository = createHybridHomeRsvpRepository(registry, {
      supabase: async environment => { providerCalls.push(`supabase:${environment}`); return provider; },
      icp: async canister => { providerCalls.push(`icp:${canister.toText()}`); return provider; },
    });

    const result = await repository.fetchRsvpsAcrossClubs('user-1', [{ clubId: CLUB_A, eventIds: ['event-1'] }]);

    expect(result.rows).toEqual(rows);
    expect(result.groups[CLUB_A]).toEqual({ status: 'ok', rows });
    expect(providerCalls).toEqual([mode === 'supabase' ? 'supabase:home-rsvp-au' : `icp:${ICP_A.toText()}`]);

    // Provider client reuse: a second call to the same club routes without
    // invoking the factory again.
    await repository.fetchRsvpsAcrossClubs('user-1', [{ clubId: CLUB_A, eventIds: ['event-1'] }]);
    expect(providerCalls).toHaveLength(1);
  });
}

test('merges RSVP rows from multiple clubs placed on different backends without cross-club leakage', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'home-rsvp-au' } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const rowsA: HomeUserRsvp[] = [{ event_id: 'event-a', status: 'going' }];
  const rowsB: HomeUserRsvp[] = [{ event_id: 'event-b', status: 'maybe' }];
  const repository = createHybridHomeRsvpRepository(registry, {
    supabase: async () => makeProvider(rowsA),
    icp: async () => makeProvider(rowsB),
  });

  const result = await repository.fetchRsvpsAcrossClubs('user-1', [
    { clubId: CLUB_A, eventIds: ['event-a'] },
    { clubId: CLUB_B, eventIds: ['event-b'] },
  ]);

  expect(result.rows).toEqual([...rowsA, ...rowsB]);
  expect(result.groups[CLUB_A]).toEqual({ status: 'ok', rows: rowsA });
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', rows: rowsB });
});

test('reports skipped-query clubs as ok with no rows without resolving a provider', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'home-rsvp-au' } } },
  ]);
  const icp = vi.fn();
  const supabase = vi.fn();
  const repository = createHybridHomeRsvpRepository(registry, { supabase, icp });

  const result = await repository.fetchRsvpsAcrossClubs('user-1', [{ clubId: CLUB_A, eventIds: [] }]);

  expect(result.rows).toEqual([]);
  expect(result.groups[CLUB_A]).toEqual({ status: 'ok', rows: [] });
  expect(supabase).not.toHaveBeenCalled();
  expect(icp).not.toHaveBeenCalled();
});

test('reports one unavailable club without dropping another club\'s rows, and never falls back to Supabase for the failing club', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Icp: { canister: ICP_A } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const rowsB: HomeUserRsvp[] = [{ event_id: 'event-b', status: 'going' }];
  let supabaseCalls = 0;
  const repository = createHybridHomeRsvpRepository(registry, {
    supabase: async () => { supabaseCalls += 1; throw new Error('Supabase must not be used in ICP mode'); },
    icp: async canister => {
      if (canister.toText() === ICP_A.toText()) throw new Error('local ICP RSVP provider unavailable');
      return makeProvider(rowsB);
    },
  });

  const result = await repository.fetchRsvpsAcrossClubs('user-1', [
    { clubId: CLUB_A, eventIds: ['event-a'] },
    { clubId: CLUB_B, eventIds: ['event-b'] },
  ]);

  expect(result.groups[CLUB_A]).toEqual({
    status: 'unavailable',
    error: expect.objectContaining({ message: 'local ICP RSVP provider unavailable' }),
  });
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', rows: rowsB });
  expect(result.rows).toEqual(rowsB);
  expect(supabaseCalls).toBe(0);
});

test('surfaces an unavailable backend placement for one club with no fallback, keeping the other club independent', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'au', backend: { Icp: { canister: ICP_A } } }, // lowercase country fails country_allowed for this club only
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const rowsB: HomeUserRsvp[] = [{ event_id: 'event-b', status: 'going' }];
  let supabaseCalls = 0;
  const repository = createHybridHomeRsvpRepository(registry, {
    supabase: async () => { supabaseCalls += 1; throw new Error('Supabase must not be used in ICP mode'); },
    icp: async () => makeProvider(rowsB),
  });

  const result = await repository.fetchRsvpsAcrossClubs('user-1', [
    { clubId: CLUB_A, eventIds: ['event-a'] },
    { clubId: CLUB_B, eventIds: ['event-b'] },
  ]);

  expect(result.groups[CLUB_A].status).toBe('unavailable');
  if (result.groups[CLUB_A].status === 'unavailable') {
    expect(String((result.groups[CLUB_A] as { error: unknown }).error)).toMatch(/Backend unavailable/);
  }
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', rows: rowsB });
  expect(result.rows).toEqual(rowsB);
  expect(supabaseCalls).toBe(0);
});
