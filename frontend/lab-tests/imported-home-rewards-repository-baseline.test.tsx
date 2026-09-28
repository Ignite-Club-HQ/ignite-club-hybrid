import { Principal } from '@icp-sdk/core/principal';
import { expect, test, vi } from 'vitest';
import {
  createHybridHomeRewardsRepository,
  fetchAvailableHomeRewardsForClub,
  mergeHomeUserChildren,
  selectNextHomeRewardInfo,
  type ClubReward,
  type HomeChild,
  type HomeRewardsProvider,
} from '../src/lab/hybridHomeRewardsRepository';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-rewards-a';
const CLUB_B = 'club-rewards-b';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

function makeProvider(rewards: ClubReward[]): HomeRewardsProvider {
  return { listAvailableRewards: async () => rewards };
}

const sampleRewardA: ClubReward = {
  id: 'reward-1',
  club_id: CLUB_A,
  name: 'Club Scarf',
  description: 'Warm winter scarf',
  points_required: 100,
  reward_type: 'general',
  is_active: true,
  qr_code_url: null,
  show_qr_code: false,
};

const sampleRewardB: ClubReward = {
  id: 'reward-2',
  club_id: CLUB_B,
  name: 'Training Jersey',
  description: 'Club match jersey',
  points_required: 250,
  reward_type: 'general',
  is_active: true,
  qr_code_url: null,
  show_qr_code: false,
};

// Pure function contracts

test('fetchAvailableHomeRewardsForClub does not call provider when clubId is empty', async () => {
  const listAvailableRewards = vi.fn().mockResolvedValue([]);
  await expect(fetchAvailableHomeRewardsForClub({ listAvailableRewards }, '')).resolves.toEqual([]);
  expect(listAvailableRewards).not.toHaveBeenCalled();
});

test('fetchAvailableHomeRewardsForClub queries active rewards for the specified club', async () => {
  const listAvailableRewards = vi.fn().mockResolvedValue([sampleRewardA]);
  await expect(fetchAvailableHomeRewardsForClub({ listAvailableRewards }, CLUB_A)).resolves.toEqual([sampleRewardA]);
  expect(listAvailableRewards).toHaveBeenCalledWith(CLUB_A);
});

test('fetchAvailableHomeRewardsForClub propagates provider error directly', async () => {
  const failure = new Error('rewards service unavailable');
  const provider: HomeRewardsProvider = {
    listAvailableRewards: async () => { throw failure; },
  };
  await expect(fetchAvailableHomeRewardsForClub(provider, CLUB_A)).rejects.toBe(failure);
});

describe('selectNextHomeRewardInfo', () => {
  it('returns null when no eligible Pro club exists and user is not app admin', () => {
    const rewards = { [CLUB_A]: [sampleRewardA] };
    const eligible = [{ id: CLUB_A, hasPro: false }];
    expect(selectNextHomeRewardInfo(rewards, eligible, false)).toBeNull();
  });

  it('selects lowest points required reward among Pro clubs', () => {
    const rewards = {
      [CLUB_A]: [sampleRewardA], // 100 pts
      [CLUB_B]: [sampleRewardB], // 250 pts
    };
    const eligible = [
      { id: CLUB_A, hasPro: false },
      { id: CLUB_B, hasPro: true },
    ];
    expect(selectNextHomeRewardInfo(rewards, eligible, false)).toEqual({
      points_required: 250,
      name: 'Training Jersey',
    });
  });

  it('includes non-Pro clubs when isAppAdmin is true', () => {
    const rewards = {
      [CLUB_A]: [sampleRewardA], // 100 pts
      [CLUB_B]: [sampleRewardB], // 250 pts
    };
    const eligible = [
      { id: CLUB_A, hasPro: false },
      { id: CLUB_B, hasPro: true },
    ];
    expect(selectNextHomeRewardInfo(rewards, eligible, true)).toEqual({
      points_required: 100,
      name: 'Club Scarf',
    });
  });

  it('filters out player_of_match and inactive rewards', () => {
    const pomReward: ClubReward = {
      ...sampleRewardA,
      id: 'reward-pom',
      reward_type: 'player_of_match',
      points_required: 10,
    };
    const inactiveReward: ClubReward = {
      ...sampleRewardA,
      id: 'reward-inactive',
      is_active: false,
      points_required: 20,
    };
    const rewards = {
      [CLUB_A]: [pomReward, inactiveReward, sampleRewardA],
    };
    const eligible = [{ id: CLUB_A, hasPro: true }];
    expect(selectNextHomeRewardInfo(rewards, eligible, false)).toEqual({
      points_required: 100,
      name: 'Club Scarf',
    });
  });

  it('breaks ties deterministically by name', () => {
    const rewardX: ClubReward = { ...sampleRewardA, id: 'rx', name: 'Zebra', points_required: 50 };
    const rewardY: ClubReward = { ...sampleRewardA, id: 'ry', name: 'Apple', points_required: 50 };
    const rewards = { [CLUB_A]: [rewardX, rewardY] };
    const eligible = [{ id: CLUB_A, hasPro: true }];
    expect(selectNextHomeRewardInfo(rewards, eligible, false)).toEqual({
      points_required: 50,
      name: 'Apple',
    });
  });
});

describe('mergeHomeUserChildren', () => {
  it('merges owned and guardian-linked children, de-duplicates and sorts by name', () => {
    const owned: HomeChild[] = [
      { id: 'child-2', name: 'Zack', ignite_points: 20 },
      { id: 'child-1', name: 'Alice', ignite_points: 10 },
    ];
    const guardianLinks = [
      { children: { id: 'child-2', name: 'Zack', ignite_points: 20 } },
      { children: { id: 'child-3', name: 'Charlie', ignite_points: 30 } },
    ];
    const merged = mergeHomeUserChildren(owned, guardianLinks);
    expect(merged).toEqual([
      { id: 'child-1', name: 'Alice', ignite_points: 10 },
      { id: 'child-3', name: 'Charlie', ignite_points: 30 },
      { id: 'child-2', name: 'Zack', ignite_points: 20 },
    ]);
  });

  it('handles null, undefined or empty lists safely', () => {
    expect(mergeHomeUserChildren(null, undefined)).toEqual([]);
    expect(mergeHomeUserChildren([{ id: 'c1', name: 'Sam', ignite_points: 5 }], null)).toEqual([
      { id: 'c1', name: 'Sam', ignite_points: 5 },
    ]);
    expect(mergeHomeUserChildren(undefined, [{ children: { id: 'c2', name: 'Bob', ignite_points: 0 } }])).toEqual([
      { id: 'c2', name: 'Bob', ignite_points: 0 },
    ]);
  });
});

// Placement-routed hybrid repository contracts

for (const mode of ['supabase', 'icp'] as const) {
  test(`reads available rewards and reuses the provider in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase' ? { Supabase: { environment: 'home-rewards-au' } } : { Icp: { canister: ICP_A } },
    }]);
    const provider = makeProvider([sampleRewardA]);
    const providerCalls: string[] = [];
    const repository = createHybridHomeRewardsRepository(registry, {
      supabase: async environment => { providerCalls.push(`supabase:${environment}`); return provider; },
      icp: async canister => { providerCalls.push(`icp:${canister.toText()}`); return provider; },
    });

    const rewards = await repository.fetchAvailableRewards(CLUB_A);
    expect(rewards).toEqual([sampleRewardA]);
    expect(providerCalls).toEqual([mode === 'supabase' ? 'supabase:home-rewards-au' : `icp:${ICP_A.toText()}`]);

    // Second call to same club reuses the cached provider
    await repository.fetchAvailableRewards(CLUB_A);
    expect(providerCalls).toHaveLength(1);
  });
}

test('merges rewards from multiple clubs placed on different backends without cross-club leakage', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'home-rewards-au' } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const repository = createHybridHomeRewardsRepository(registry, {
    supabase: async () => makeProvider([sampleRewardA]),
    icp: async () => makeProvider([sampleRewardB]),
  });

  const result = await repository.fetchRewardsAcrossClubs([CLUB_A, CLUB_B]);

  expect(result.rewardsByClub[CLUB_A]).toEqual([sampleRewardA]);
  expect(result.rewardsByClub[CLUB_B]).toEqual([sampleRewardB]);
  expect(result.groups[CLUB_A]).toEqual({ status: 'ok', rewards: [sampleRewardA] });
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', rewards: [sampleRewardB] });
});

test('reports one unavailable club without dropping another club\'s rewards, and never falls back to Supabase for the failing club', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Icp: { canister: ICP_A } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  let supabaseCalls = 0;
  const repository = createHybridHomeRewardsRepository(registry, {
    supabase: async () => { supabaseCalls += 1; throw new Error('Supabase must not be used in ICP mode'); },
    icp: async canister => {
      if (canister.toText() === ICP_A.toText()) throw new Error('local ICP rewards provider unavailable');
      return makeProvider([sampleRewardB]);
    },
  });

  const result = await repository.fetchRewardsAcrossClubs([CLUB_A, CLUB_B]);

  expect(result.groups[CLUB_A]).toEqual({
    status: 'unavailable',
    error: expect.objectContaining({ message: 'local ICP rewards provider unavailable' }),
  });
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', rewards: [sampleRewardB] });
  expect(result.rewardsByClub[CLUB_B]).toEqual([sampleRewardB]);
  expect(result.rewardsByClub[CLUB_A]).toBeUndefined();
  expect(supabaseCalls).toBe(0);
});

test('surfaces an unavailable backend placement for one club with no fallback, keeping the other club independent', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'au', backend: { Icp: { canister: ICP_A } } }, // lowercase country fails country_allowed
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  let supabaseCalls = 0;
  const repository = createHybridHomeRewardsRepository(registry, {
    supabase: async () => { supabaseCalls += 1; throw new Error('Supabase must not be used in ICP mode'); },
    icp: async () => makeProvider([sampleRewardB]),
  });

  const result = await repository.fetchRewardsAcrossClubs([CLUB_A, CLUB_B]);

  expect(result.groups[CLUB_A].status).toBe('unavailable');
  if (result.groups[CLUB_A].status === 'unavailable') {
    expect(String((result.groups[CLUB_A] as { error: unknown }).error)).toMatch(/Backend unavailable/);
  }
  expect(result.groups[CLUB_B]).toEqual({ status: 'ok', rewards: [sampleRewardB] });
  expect(result.rewardsByClub[CLUB_B]).toEqual([sampleRewardB]);
  expect(supabaseCalls).toBe(0);
});

test('fetchNextRewardInfo queries only eligible clubs and selects the next reward', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'home-rewards-au' } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const repository = createHybridHomeRewardsRepository(registry, {
    supabase: async () => makeProvider([sampleRewardA]), // 100 pts
    icp: async () => makeProvider([sampleRewardB]), // 250 pts
  });

  // CLUB_A hasPro: false, CLUB_B hasPro: true
  const info = await repository.fetchNextRewardInfo(
    [{ id: CLUB_A, hasPro: false }, { id: CLUB_B, hasPro: true }],
    false,
  );
  expect(info).toEqual({ points_required: 250, name: 'Training Jersey' });

  // If app admin, includes CLUB_A (100 pts)
  const adminInfo = await repository.fetchNextRewardInfo(
    [{ id: CLUB_A, hasPro: false }, { id: CLUB_B, hasPro: true }],
    true,
  );
  expect(adminInfo).toEqual({ points_required: 100, name: 'Club Scarf' });
});

test('fetchNextRewardInfo returns null without querying when no clubs are eligible', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'home-rewards-au' } } },
  ]);
  const supabase = vi.fn();
  const icp = vi.fn();
  const repository = createHybridHomeRewardsRepository(registry, { supabase, icp });

  const info = await repository.fetchNextRewardInfo([{ id: CLUB_A, hasPro: false }], false);
  expect(info).toBeNull();
  expect(supabase).not.toHaveBeenCalled();
  expect(icp).not.toHaveBeenCalled();
});
