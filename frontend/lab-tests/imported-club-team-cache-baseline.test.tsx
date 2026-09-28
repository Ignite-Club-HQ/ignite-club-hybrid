import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import {
  createHybridClubTeamCache,
  type CachedClub,
  type CachedTeam,
  type ClubTeamMetadataProvider,
} from '../src/lab/hybridClubTeamCache';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-cache-a';
const ICP_A = Principal.fromText('aaaaa-aa');

const club = (id: string): Omit<CachedClub, 'cached_at'> => ({
  id,
  name: `Club ${id}`,
  logo_url: null,
  sport: 'synthetic',
  is_pro: false,
});

const team = (id: string): Omit<CachedTeam, 'cached_at'> => ({
  id,
  name: `Team ${id}`,
  logo_url: null,
  club_id: CLUB_A,
  level_age: null,
});

for (const mode of ['supabase', 'icp'] as const) {
  test(`preserves metadata cache misses and hits in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'cache-au' } }
        : { Icp: { canister: ICP_A } },
    }]);
    let clock = 1_000;
    const calls: string[] = [];
    const provider: ClubTeamMetadataProvider = {
      getClubs: async ids => {
        calls.push(`clubs:${ids.join(',')}`);
        return ids.map(id => ({ ...club(id), cached_at: 0 }));
      },
      getTeams: async ids => {
        calls.push(`teams:${ids.join(',')}`);
        return ids.map(id => ({ ...team(id), cached_at: 0 }));
      },
    };
    const cache = createHybridClubTeamCache(registry, {
      supabase: async environment => {
        calls.push(`provider:supabase:${environment}`);
        return provider;
      },
      icp: async canister => {
        calls.push(`provider:icp:${canister.toText()}`);
        return provider;
      },
    }, { ttlMs: 100, now: () => clock });

    await expect(cache.fetchClubs(CLUB_A, [CLUB_A])).resolves.toMatchObject({
      cached: [club(CLUB_A)],
      missing: [],
    });
    await expect(cache.fetchClubs(CLUB_A, [CLUB_A])).resolves.toMatchObject({
      cached: [club(CLUB_A)],
      missing: [],
    });
    await expect(cache.fetchTeams(CLUB_A, ['team-a'])).resolves.toMatchObject({
      cached: [team('team-a')],
      missing: [],
    });
    expect(calls).toEqual([
      mode === 'supabase' ? 'provider:supabase:cache-au' : `provider:icp:${ICP_A.toText()}`,
      'clubs:club-cache-a',
      'teams:team-a',
    ]);

    clock += 100;
    expect(cache.getCachedClub(CLUB_A)).toBeNull();
  });
}

test('preserves batch cache hits and explicit invalidation', () => {
  const registry = createSyntheticPlacementRegistry();
  const cache = createHybridClubTeamCache(registry, {
    supabase: async () => ({ getClubs: async () => [], getTeams: async () => [] }),
    icp: async () => ({ getClubs: async () => [], getTeams: async () => [] }),
  }, { now: () => 1_000 });

  cache.cacheClubs([club(CLUB_A), club('club-cache-b')]);
  expect(cache.getCachedClubs([CLUB_A, 'club-cache-b', 'missing'])).toEqual({
    cached: [expect.objectContaining({ id: CLUB_A }), expect.objectContaining({ id: 'club-cache-b' })],
    missing: ['missing'],
  });
  cache.invalidateClub(CLUB_A);
  expect(cache.getCachedClub(CLUB_A)).toBeNull();
});

test('does not fall back to Supabase when the selected ICP provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const cache = createHybridClubTeamCache(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP metadata provider unavailable');
    },
  });

  await expect(cache.fetchTeams(CLUB_A, ['team-a']))
    .rejects.toThrow('local ICP metadata provider unavailable');
  expect(supabaseCalls).toBe(0);
});
