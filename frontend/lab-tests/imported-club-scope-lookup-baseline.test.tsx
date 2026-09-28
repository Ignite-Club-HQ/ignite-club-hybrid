import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import {
  createHybridClubScopeLookup,
  type ClubScopeProvider,
} from '../src/lab/hybridClubScopeLookup';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const PLACEMENT_CLUB = 'club-scope-placement';
const ICP_CANISTER = Principal.fromText('aaaaa-aa');

for (const mode of ['supabase', 'icp'] as const) {
  test(`resolves direct and team-fallback route scope in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: PLACEMENT_CLUB,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'scope-au' } }
        : { Icp: { canister: ICP_CANISTER } },
    }]);
    const calls: string[] = [];
    const provider: ClubScopeProvider = {
      lookupRow: async (table, id) => {
        calls.push(`row:${table}:${id}`);
        if (id === 'direct-event') return { clubId: 'club-owned', teamId: null };
        if (id === 'team-event') return { clubId: null, teamId: 'team-1' };
        return null;
      },
      lookupTeamClubId: async teamId => {
        calls.push(`team:${teamId}`);
        return { clubId: 'club-from-team' };
      },
    };
    const providers = {
      supabase: async environment => {
        calls.push(`provider:supabase:${environment}`);
        return provider;
      },
      icp: async canister => {
        calls.push(`provider:icp:${canister.toText()}`);
        return provider;
      },
    };
    const service = createHybridClubScopeLookup(registry, providers);

    await expect(service.lookupRouteClubId(PLACEMENT_CLUB, 'events', 'direct-event'))
      .resolves.toBe('club-owned');
    await expect(service.lookupRouteClubId(PLACEMENT_CLUB, 'events', 'team-event'))
      .resolves.toBe('club-from-team');
    await expect(service.lookupRouteClubId(PLACEMENT_CLUB, 'events', 'missing'))
      .resolves.toBeNull();

    expect(calls).toEqual([
      mode === 'supabase' ? 'provider:supabase:scope-au' : `provider:icp:${ICP_CANISTER.toText()}`,
      'row:events:direct-event',
      'row:events:team-event',
      'team:team-1',
      'row:events:missing',
    ]);
  });
}

test('does not perform team fallback for a table with a direct nullable scope', async () => {
  const registry = createSyntheticPlacementRegistry([{
    clubId: PLACEMENT_CLUB,
    country: 'AU',
    backend: { Icp: { canister: ICP_CANISTER } },
  }]);
  let teamLookupCalls = 0;
  const service = createHybridClubScopeLookup(registry, {
    supabase: async () => ({
      lookupRow: async () => ({ clubId: null, teamId: 'team-1' }),
      lookupTeamClubId: async () => ({ clubId: 'unused' }),
    }),
    icp: async () => ({
      lookupRow: async () => ({ clubId: null, teamId: 'team-1' }),
      lookupTeamClubId: async () => {
        teamLookupCalls += 1;
        return { clubId: 'unused' };
      },
    }),
  });

  await expect(service.lookupRouteClubId(PLACEMENT_CLUB, 'mini_leagues', 'league-1'))
    .resolves.toBeNull();
  expect(teamLookupCalls).toBe(0);
});

test('returns null for malformed provider rows without guessing a club', async () => {
  const registry = createSyntheticPlacementRegistry([{
    clubId: PLACEMENT_CLUB,
    country: 'AU',
    backend: { Supabase: { environment: 'scope-au' } },
  }]);
  const service = createHybridClubScopeLookup(registry, {
    supabase: async () => ({
      lookupRow: async () => ({ clubId: 42, teamId: 'team-1' }),
      lookupTeamClubId: async () => ({ clubId: 'should-not-be-used' }),
    }),
    icp: async () => {
      throw new Error('ICP provider must not be selected');
    },
  });

  await expect(service.lookupRouteClubId(PLACEMENT_CLUB, 'events', 'bad-row'))
    .resolves.toBeNull();
});

test('does not fall back to Supabase when the selected ICP provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: PLACEMENT_CLUB,
    country: 'AU',
    backend: { Icp: { canister: ICP_CANISTER } },
  }]);
  const service = createHybridClubScopeLookup(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP scope lookup unavailable');
    },
  });

  await expect(service.lookupRouteClubId(PLACEMENT_CLUB, 'events', 'event-1'))
    .rejects.toThrow('local ICP scope lookup unavailable');
  expect(supabaseCalls).toBe(0);
});
