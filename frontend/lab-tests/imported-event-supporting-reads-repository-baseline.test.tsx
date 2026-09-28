import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, test, vi } from 'vitest';
import {
  createHybridEventSupportingReadsRepository,
  fetchEventDuties,
  fetchEventGuests,
  type EventDutyRow,
  type EventGuestRow,
  type EventSupportingReadsProvider,
} from '../src/lab/hybridEventSupportingReadsRepository';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-supporting-a';
const CLUB_B = 'club-supporting-b';
const EVENT_A = 'event-supporting-a';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

function makeProvider(options: {
  guests?: EventGuestRow[];
  duties?: EventDutyRow[];
  guestError?: unknown;
  dutyError?: unknown;
} = {}): EventSupportingReadsProvider {
  return {
    listEventGuests: vi.fn(async eventId => {
      if (options.guestError) throw options.guestError;
      return (options.guests ?? []).map(guest => ({ ...guest, event_id: guest.event_id ?? eventId }));
    }),
    listEventDuties: vi.fn(async eventId => {
      if (options.dutyError) throw options.dutyError;
      return (options.duties ?? []).map(duty => ({ ...duty, event_id: duty.event_id ?? eventId }));
    }),
  };
}

describe('event guest supporting read adaptation', () => {
  test('isolates guests to one event and deduplicates profile enrichment', async () => {
    const provider = makeProvider({
      guests: [
        { id: 'g1', added_by: 'adult-1', name: 'Guest One' },
        { id: 'g2', added_by: 'adult-1', name: 'Guest Two' },
      ],
    });
    const profiles = vi.fn().mockResolvedValue([
      { id: 'adult-1', display_name: 'Adult One', avatar_url: null },
    ]);

    const result = await fetchEventGuests(provider, EVENT_A, profiles);

    expect(provider.listEventGuests).toHaveBeenCalledWith(EVENT_A);
    expect(profiles).toHaveBeenCalledWith(['adult-1']);
    expect(result.adderProfilesEnrichment).toEqual({ status: 'ok' });
    expect(result.rows.map(row => row.added_by_name)).toEqual(['Adult One', 'Adult One']);
  });

  test('uses a neutral fallback and reports degraded profile enrichment', async () => {
    const profileError = new Error('profiles unavailable');
    const provider = makeProvider({ guests: [{ id: 'g1', added_by: 'adult-1' }] });
    const profiles = vi.fn().mockRejectedValue(profileError);

    await expect(fetchEventGuests(provider, EVENT_A, profiles)).resolves.toEqual({
      rows: [expect.objectContaining({ id: 'g1', added_by_name: 'A member' })],
      adderProfilesEnrichment: { status: 'unavailable', error: profileError },
    });
  });

  test('propagates an authoritative guest read failure without loading profiles', async () => {
    const denied = new Error('denied');
    const profiles = vi.fn();

    await expect(fetchEventGuests(makeProvider({ guestError: denied }), EVENT_A, profiles))
      .rejects.toBe(denied);
    expect(profiles).not.toHaveBeenCalled();
  });
});

describe('event duty supporting read adaptation', () => {
  test('reads duties and assignee display context for exactly one event', async () => {
    const rows = [{
      id: 'd1',
      assigned_to: 'adult-1',
      profiles: { display_name: 'Adult One', avatar_url: null },
    }];
    const provider = makeProvider({ duties: rows });

    await expect(fetchEventDuties(provider, EVENT_A)).resolves.toEqual([
      expect.objectContaining({ id: 'd1', event_id: EVENT_A }),
    ]);
    expect(provider.listEventDuties).toHaveBeenCalledWith(EVENT_A);
  });

  test('propagates duty read failures rather than returning an empty list', async () => {
    const unavailable = new Error('duties unavailable');

    await expect(fetchEventDuties(makeProvider({ dutyError: unavailable }), EVENT_A))
      .rejects.toBe(unavailable);
  });
});

for (const mode of ['supabase', 'icp'] as const) {
  test(`routes supporting reads through explicit ${mode} provider and reuses it`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'event-supporting-au' } }
        : { Icp: { canister: ICP_A } },
    }]);
    const provider = makeProvider({
      guests: [{ id: 'g1', added_by: 'adult-1' }],
      duties: [{ id: 'd1', assigned_to: 'adult-1' }],
    });
    const providerCalls: string[] = [];
    const repository = createHybridEventSupportingReadsRepository(registry, {
      supabase: async environment => {
        providerCalls.push(`supabase:${environment}`);
        return provider;
      },
      icp: async canister => {
        providerCalls.push(`icp:${canister.toText()}`);
        return provider;
      },
    });
    const profiles = vi.fn().mockResolvedValue([
      { id: 'adult-1', display_name: 'Adult One', avatar_url: null },
    ]);

    const guests = await repository.fetchGuests(CLUB_A, EVENT_A, profiles);
    const duties = await repository.fetchDuties(CLUB_A, EVENT_A);

    expect(guests.rows).toEqual([
      expect.objectContaining({ id: 'g1', event_id: EVENT_A, added_by_name: 'Adult One' }),
    ]);
    expect(duties).toEqual([expect.objectContaining({ id: 'd1', event_id: EVENT_A })]);
    expect(providerCalls).toEqual([
      mode === 'supabase' ? 'supabase:event-supporting-au' : `icp:${ICP_A.toText()}`,
    ]);
    expect(provider.listEventGuests).toHaveBeenCalledWith(EVENT_A);
    expect(provider.listEventDuties).toHaveBeenCalledWith(EVENT_A);
  });
}

test('keeps supporting reads isolated across clubs on different backend placements', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'event-supporting-au' } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const repository = createHybridEventSupportingReadsRepository(registry, {
    supabase: async () => makeProvider({ guests: [{ id: 'supabase-guest', added_by: null }] }),
    icp: async () => makeProvider({ guests: [{ id: 'icp-guest', added_by: null }] }),
  });

  await expect(repository.fetchGuests(CLUB_A, EVENT_A, vi.fn())).resolves.toEqual({
    rows: [expect.objectContaining({ id: 'supabase-guest', added_by_name: 'A member' })],
    adderProfilesEnrichment: { status: 'skipped' },
  });
  await expect(repository.fetchGuests(CLUB_B, EVENT_A, vi.fn())).resolves.toEqual({
    rows: [expect.objectContaining({ id: 'icp-guest', added_by_name: 'A member' })],
    adderProfilesEnrichment: { status: 'skipped' },
  });
});

test('does not fall back to Supabase when the selected ICP provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const repository = createHybridEventSupportingReadsRepository(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP supporting reads provider unavailable');
    },
  });

  await expect(repository.fetchGuests(CLUB_A, EVENT_A, vi.fn()))
    .rejects.toThrow('local ICP supporting reads provider unavailable');
  expect(supabaseCalls).toBe(0);
});

test('surfaces an unavailable backend placement with no fallback', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  registry.setAvailability('icp', false);
  const repository = createHybridEventSupportingReadsRepository(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => makeProvider({ duties: [{ id: 'unreachable' }] }),
  });

  await expect(repository.fetchDuties(CLUB_A, EVENT_A)).rejects.toThrow(/Backend unavailable/);
  expect(supabaseCalls).toBe(0);
});
