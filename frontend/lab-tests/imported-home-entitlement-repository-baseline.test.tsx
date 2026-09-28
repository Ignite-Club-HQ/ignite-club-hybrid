import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, test, vi } from 'vitest';
import {
  createHybridHomeEntitlementRepository,
  fetchHomeProAccessForClub,
  fetchHomeRewardClubForClub,
  normalizeHomeEntitlementScopes,
  resolveHomeProAccess,
  type HomeEntitlementProvider,
  type HomeRewardClub,
} from '../src/lab/hybridHomeEntitlementRepository';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-entitlements-a';
const CLUB_B = 'club-entitlements-b';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

const clubA: HomeRewardClub = {
  id: CLUB_A,
  name: 'Riverside',
  logo_url: null,
  hasPro: true,
};

const clubB: HomeRewardClub = {
  id: CLUB_B,
  name: 'Hillview',
  logo_url: 'https://example.invalid/logo.png',
  hasPro: false,
};

function makeProvider(options: {
  hasPro?: boolean;
  club?: HomeRewardClub | null;
} = {}): HomeEntitlementProvider {
  return {
    hasHomeProAccess: async () => options.hasPro ?? false,
    getHomeRewardClub: async () => options.club ?? null,
  };
}

describe('resolveHomeProAccess', () => {
  test('accepts every supported club and team Pro entitlement flag', () => {
    for (const flag of [
      'is_pro',
      'is_pro_football',
      'admin_pro_override',
      'admin_pro_football_override',
    ] as const) {
      expect(resolveHomeProAccess([{ [flag]: true }], [], [])).toBe(true);
      expect(resolveHomeProAccess([], [{ [flag]: true }], [])).toBe(true);
    }
  });

  test('retains the legacy teams.is_pro trial fallback', () => {
    expect(resolveHomeProAccess([], [], [{ is_pro: true }])).toBe(true);
  });

  test('fails closed when entitlement read payloads are absent', () => {
    expect(resolveHomeProAccess(null, undefined, null)).toBe(false);
  });
});

test('normalizeHomeEntitlementScopes groups team ids by owning club and de-duplicates them', () => {
  expect(normalizeHomeEntitlementScopes([
    { clubId: CLUB_A, teamIds: ['team-1', 'team-2', 'team-1'] },
    { clubId: '', teamIds: ['ignored-team'] },
    { clubId: CLUB_B },
    { clubId: CLUB_A, teamIds: ['team-3', ''] },
  ])).toEqual([
    { clubId: CLUB_A, teamIds: ['team-1', 'team-2', 'team-3'] },
    { clubId: CLUB_B, teamIds: [] },
  ]);
});

test('fetchHomeProAccessForClub passes the club scope to the provider', async () => {
  const hasHomeProAccess = vi.fn().mockResolvedValue(true);
  await expect(
    fetchHomeProAccessForClub({ ...makeProvider(), hasHomeProAccess }, { clubId: CLUB_A, teamIds: ['team-1'] }),
  ).resolves.toBe(true);
  expect(hasHomeProAccess).toHaveBeenCalledWith(CLUB_A, ['team-1']);
});

test('fetchHomeRewardClubForClub returns the provider reward-club row', async () => {
  const getHomeRewardClub = vi.fn().mockResolvedValue(clubA);
  await expect(
    fetchHomeRewardClubForClub({ ...makeProvider(), getHomeRewardClub }, CLUB_A),
  ).resolves.toEqual(clubA);
  expect(getHomeRewardClub).toHaveBeenCalledWith(CLUB_A);
});

for (const mode of ['supabase', 'icp'] as const) {
  test(`reads Pro access and reuses the provider in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase' ? { Supabase: { environment: 'home-entitlements-au' } } : { Icp: { canister: ICP_A } },
    }]);
    const providerCalls: string[] = [];
    const repository = createHybridHomeEntitlementRepository(registry, {
      supabase: async environment => { providerCalls.push(`supabase:${environment}`); return makeProvider({ hasPro: true }); },
      icp: async canister => { providerCalls.push(`icp:${canister.toText()}`); return makeProvider({ hasPro: true }); },
    });

    const result = await repository.fetchProAccessAcrossClubs([{ clubId: CLUB_A, teamIds: ['team-1'] }]);

    expect(result.hasPro).toBe(true);
    expect(result.groups[CLUB_A]).toEqual({ status: 'ok', hasPro: true });
    expect(providerCalls).toEqual([mode === 'supabase' ? 'supabase:home-entitlements-au' : `icp:${ICP_A.toText()}`]);

    await repository.fetchProAccessAcrossClubs([{ clubId: CLUB_A, teamIds: ['team-2'] }]);
    expect(providerCalls).toHaveLength(1);
  });
}

test('returns fail-closed false without resolving providers when no club scopes exist', async () => {
  const registry = createSyntheticPlacementRegistry();
  const supabase = vi.fn();
  const icp = vi.fn();
  const repository = createHybridHomeEntitlementRepository(registry, { supabase, icp });

  await expect(repository.fetchProAccessAcrossClubs([])).resolves.toEqual({
    hasPro: false,
    groups: {},
  });
  expect(supabase).not.toHaveBeenCalled();
  expect(icp).not.toHaveBeenCalled();
});

test('merges Pro access outcomes from clubs placed on different backends', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'home-entitlements-au' } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const repository = createHybridHomeEntitlementRepository(registry, {
    supabase: async () => makeProvider({ hasPro: false }),
    icp: async () => makeProvider({ hasPro: true }),
  });

  const result = await repository.fetchProAccessAcrossClubs([
    { clubId: CLUB_A, teamIds: ['team-a'] },
    { clubId: CLUB_B, teamIds: ['team-b'] },
  ]);

  expect(result.hasPro).toBe(true);
  expect(result.groups[CLUB_A]).toEqual({ status: 'ok', hasPro: false });
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', hasPro: true });
});

test('reports one unavailable Pro access club with no Supabase fallback while another club succeeds', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Icp: { canister: ICP_A } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  let supabaseCalls = 0;
  const repository = createHybridHomeEntitlementRepository(registry, {
    supabase: async () => { supabaseCalls += 1; throw new Error('Supabase must not be used in ICP mode'); },
    icp: async canister => {
      if (canister.toText() === ICP_A.toText()) throw new Error('local ICP entitlement provider unavailable');
      return makeProvider({ hasPro: true });
    },
  });

  const result = await repository.fetchProAccessAcrossClubs([
    { clubId: CLUB_A, teamIds: ['team-a'] },
    { clubId: CLUB_B, teamIds: ['team-b'] },
  ]);

  expect(result.hasPro).toBe(true);
  expect(result.groups[CLUB_A]).toEqual({
    status: 'unavailable',
    error: expect.objectContaining({ message: 'local ICP entitlement provider unavailable' }),
  });
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', hasPro: true });
  expect(supabaseCalls).toBe(0);
});

test('surfaces unavailable placement for Pro access with no fallback', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'au', backend: { Icp: { canister: ICP_A } } },
  ]);
  let supabaseCalls = 0;
  const repository = createHybridHomeEntitlementRepository(registry, {
    supabase: async () => { supabaseCalls += 1; throw new Error('Supabase must not be used in ICP mode'); },
    icp: async () => makeProvider({ hasPro: true }),
  });

  const result = await repository.fetchProAccessAcrossClubs([{ clubId: CLUB_A }]);

  expect(result.hasPro).toBe(false);
  expect(result.groups[CLUB_A].status).toBe('unavailable');
  if (result.groups[CLUB_A].status === 'unavailable') {
    expect(String(result.groups[CLUB_A].error)).toMatch(/Backend unavailable/);
  }
  expect(supabaseCalls).toBe(0);
});

test('scopes reward clubs to the active club and its routed provider', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'home-entitlements-au' } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const supabaseProvider = {
    ...makeProvider({ club: clubA }),
    getHomeRewardClub: vi.fn().mockResolvedValue(clubA),
  };
  const icp = vi.fn();
  const repository = createHybridHomeEntitlementRepository(registry, {
    supabase: async () => supabaseProvider,
    icp,
  });

  const result = await repository.fetchRewardClubs([CLUB_A, CLUB_B], CLUB_A);

  expect(result.clubs).toEqual([clubA]);
  expect(result.groups[CLUB_A]).toEqual({ status: 'ok', club: clubA });
  expect(supabaseProvider.getHomeRewardClub).toHaveBeenCalledWith(CLUB_A);
  expect(icp).not.toHaveBeenCalled();
});

test('reads reward-capable clubs across placements in membership order', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'home-entitlements-au' } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const repository = createHybridHomeEntitlementRepository(registry, {
    supabase: async () => makeProvider({ club: clubA }),
    icp: async () => makeProvider({ club: clubB }),
  });

  const result = await repository.fetchRewardClubs([CLUB_A, CLUB_B, CLUB_A], null);

  expect(result.clubs).toEqual([clubA, clubB]);
  expect(result.groups[CLUB_A]).toEqual({ status: 'ok', club: clubA });
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', club: clubB });
});

test('reports one unavailable reward-club provider without falling back to Supabase', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Icp: { canister: ICP_A } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  let supabaseCalls = 0;
  const repository = createHybridHomeEntitlementRepository(registry, {
    supabase: async () => { supabaseCalls += 1; throw new Error('Supabase must not be used in ICP mode'); },
    icp: async canister => {
      if (canister.toText() === ICP_A.toText()) throw new Error('local ICP reward-club provider unavailable');
      return makeProvider({ club: clubB });
    },
  });

  const result = await repository.fetchRewardClubs([CLUB_A, CLUB_B], null);

  expect(result.clubs).toEqual([clubB]);
  expect(result.groups[CLUB_A]).toEqual({
    status: 'unavailable',
    error: expect.objectContaining({ message: 'local ICP reward-club provider unavailable' }),
  });
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', club: clubB });
  expect(supabaseCalls).toBe(0);
});
