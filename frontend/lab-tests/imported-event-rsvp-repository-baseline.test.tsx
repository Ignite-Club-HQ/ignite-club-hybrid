import { Principal } from '@icp-sdk/core/principal';
import { expect, test, vi } from 'vitest';
import {
  createHybridEventRsvpRepository,
  fetchEventRsvps,
  type EventRsvpProvider,
  type EventRsvpRow,
} from '../src/lab/hybridEventRsvpRepository';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-rsvp-a';
const EVENT_A = 'event-rsvp-a';
const ICP_A = Principal.fromText('aaaaa-aa');

function makeProvider(rows: EventRsvpRow[], children: Array<{ id: string; name: string }> = []): EventRsvpProvider {
  return {
    listRsvps: async () => rows,
    listChildren: async () => children,
  };
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`preserves RSVP read and enrichment semantics in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'events-rsvp-au' } }
        : { Icp: { canister: ICP_A } },
    }]);
    const provider = makeProvider(
      [
        { id: 'r1', event_id: EVENT_A, user_id: 'adult-1', child_id: null, status: 'going' },
        { id: 'r2', event_id: EVENT_A, user_id: 'guardian-1', child_id: 'child-1', status: 'maybe' },
      ],
      [{ id: 'child-1', name: 'Child One' }],
    );
    const loadProfiles = vi.fn().mockResolvedValue([
      { id: 'adult-1', display_name: 'Adult One', avatar_url: 'adult.png' },
      { id: 'guardian-1', display_name: 'Guardian', avatar_url: null },
    ]);
    const providerCalls: string[] = [];
    const repository = createHybridEventRsvpRepository(registry, {
      supabase: async environment => {
        providerCalls.push(`supabase:${environment}`);
        return provider;
      },
      icp: async canister => {
        providerCalls.push(`icp:${canister.toText()}`);
        return provider;
      },
    });

    const result = await repository.fetchRsvps(CLUB_A, EVENT_A, loadProfiles);

    expect(loadProfiles).toHaveBeenCalledWith(['adult-1', 'guardian-1']);
    expect(result.profilesEnrichment).toEqual({ status: 'ok' });
    expect(result.childrenEnrichment).toEqual({ status: 'ok' });
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: 'r1', user_id: 'adult-1', child_id: null,
        profiles: { display_name: 'Adult One', avatar_url: 'adult.png' }, children: null,
      }),
      expect.objectContaining({
        id: 'r2', user_id: 'guardian-1', child_id: 'child-1',
        profiles: { display_name: 'Guardian', avatar_url: null },
        children: { id: 'child-1', name: 'Child One' },
      }),
    ]);
    expect(providerCalls).toEqual([
      mode === 'supabase' ? 'supabase:events-rsvp-au' : `icp:${ICP_A.toText()}`,
    ]);

    // Provider client reuse: a second call routes without invoking the factory again.
    await repository.fetchRsvps(CLUB_A, EVENT_A, loadProfiles);
    expect(providerCalls).toHaveLength(1);
  });
}

test('propagates the core RSVP read failure and performs no enrichment', async () => {
  const denied = new Error('denied');
  const loadProfiles = vi.fn();
  await expect(fetchEventRsvps({
    listRsvps: async () => { throw denied; },
    listChildren: async () => [],
  }, EVENT_A, loadProfiles)).rejects.toBe(denied);
  expect(loadProfiles).not.toHaveBeenCalled();
});

test('reports skipped enrichment when no row needs it', async () => {
  const result = await fetchEventRsvps(makeProvider([]), EVENT_A, vi.fn());
  expect(result).toEqual({
    rows: [],
    profilesEnrichment: { status: 'skipped' },
    childrenEnrichment: { status: 'skipped' },
  });
});

test('keeps valid attendance rows and reports profile enrichment as unavailable, not silently dropped', async () => {
  const profilesError = new Error('profiles unavailable');
  const loadProfiles = vi.fn().mockRejectedValue(profilesError);
  const result = await fetchEventRsvps(
    makeProvider([{ id: 'r1', event_id: EVENT_A, user_id: 'adult-1', child_id: null, status: 'going' }]),
    EVENT_A,
    loadProfiles,
  );
  expect(result.rows).toEqual([
    expect.objectContaining({ id: 'r1', profiles: null, children: null }),
  ]);
  expect(result.profilesEnrichment).toEqual({ status: 'unavailable', error: profilesError });
  expect(result.childrenEnrichment).toEqual({ status: 'skipped' });
});

test('keeps valid attendance rows and reports child enrichment as unavailable, not silently dropped', async () => {
  const childrenError = new Error('children unavailable');
  const loadProfiles = vi.fn().mockResolvedValue([]);
  const result = await fetchEventRsvps({
    listRsvps: async () => [{ id: 'r1', event_id: EVENT_A, user_id: null, child_id: 'child-1', status: 'going' }],
    listChildren: async () => { throw childrenError; },
  }, EVENT_A, loadProfiles);
  expect(result.rows).toEqual([
    expect.objectContaining({ id: 'r1', profiles: null, children: null }),
  ]);
  expect(result.childrenEnrichment).toEqual({ status: 'unavailable', error: childrenError });
  // Independent lookups: a failed child fetch must not be reported as a
  // profile failure (and vice versa), so callers can attribute the notice.
  expect(result.profilesEnrichment).toEqual({ status: 'skipped' });
});

test('reports both enrichment lookups as independently unavailable without dropping rows', async () => {
  const profilesError = new Error('profiles unavailable');
  const childrenError = new Error('children unavailable');
  const loadProfiles = vi.fn().mockRejectedValue(profilesError);
  const result = await fetchEventRsvps({
    listRsvps: async () => [{ id: 'r1', event_id: EVENT_A, user_id: 'adult-1', child_id: 'child-1', status: 'going' }],
    listChildren: async () => { throw childrenError; },
  }, EVENT_A, loadProfiles);
  expect(result.rows).toEqual([
    expect.objectContaining({ id: 'r1', profiles: null, children: null }),
  ]);
  expect(result.profilesEnrichment).toEqual({ status: 'unavailable', error: profilesError });
  expect(result.childrenEnrichment).toEqual({ status: 'unavailable', error: childrenError });
});

test('does not fall back to Supabase when the selected ICP provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const repository = createHybridEventRsvpRepository(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP RSVP provider unavailable');
    },
  });

  await expect(repository.fetchRsvps(CLUB_A, EVENT_A, vi.fn()))
    .rejects.toThrow('local ICP RSVP provider unavailable');
  expect(supabaseCalls).toBe(0);
});

test('surfaces an unavailable backend placement with no fallback', async () => {
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  (registry as any).setAvailability('icp', false);
  const repository = createHybridEventRsvpRepository(registry, {
    supabase: async () => { throw new Error('Supabase must not be used in ICP mode'); },
    icp: async () => { throw new Error('unreachable'); },
  });

  await expect(repository.fetchRsvps(CLUB_A, EVENT_A, vi.fn()))
    .rejects.toThrow(/Backend unavailable/);
});
