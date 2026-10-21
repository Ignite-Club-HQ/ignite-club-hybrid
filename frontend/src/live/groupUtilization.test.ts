import { describe, expect, it } from 'vitest';
import {
  buildGroupSpecs,
  computeGroupRollup,
  parseApprovedConfiguration,
  type CanisterReading,
  type GroupSpec,
} from './groupUtilization';
import type { RoutingGatesSnapshot } from './generalActivation';

const SHARED_IDS = {
  shard_router: 'router-cai',
  placement_registry: 'registry-cai',
  migration_coordinator: 'migrator-cai',
  club_domain: 'shared-club-cai',
  media_blob_store: 'shared-store-cai',
  events_domain: 'shared-events-cai',
};

const LIMITS = { g1: { club_domain: 1_000_000_000, media_blob_store: 8_000_000_000 } };

const SNAPSHOT: RoutingGatesSnapshot = {
  approved: true,
  generatedAt: '2026-10-22T00:00:00Z',
  targetAlias: 'mainnet',
  host: 'https://icp-api.io',
  routerCanisterId: 'router-cai',
  registryRevision: '4',
  configurationRevision: '0',
  approvedConfiguration:
    '[{"id":"g2","accepting":true,"maxClubs":100,"domains":[{"domain":"club_domain","canisterId":"g2-club-cai"}]}]',
  groups: [
    {
      id: 'g2',
      domains: [
        { domain: 'club_domain', canisterId: 'g2-club-cai' },
        { domain: 'events_domain', canisterId: 'g2-events-cai' },
      ],
      photoStore: 'g2-store-cai',
      moduleHashes: {},
    },
  ],
  removalWiring: { revision: '0', groupIds: ['g2'], checkedAtMs: 0 },
  evidenceSha256: 'abc',
};

describe('buildGroupSpecs', () => {
  it('splits control-plane services out of the shared group', () => {
    const { groups, globalCanisters } = buildGroupSpecs({
      snapshot: SNAPSHOT,
      sharedCanisterIds: SHARED_IDS,
      testedLimits: LIMITS,
    });
    expect(globalCanisters.map((c) => c.key).sort()).toEqual([
      'migration_coordinator',
      'placement_registry',
      'shard_router',
    ]);
    const g1 = groups.find((g) => g.id === 'g1')!;
    expect(g1.canisters.map((c) => c.key)).not.toContain('shard_router');
    expect(g1.photoStoreId).toBe('shared-store-cai');
    expect(g1.testedLimitBytes).toEqual(LIMITS.g1);
  });

  it('builds router groups from the snapshot with policy from the approved configuration', () => {
    const { groups } = buildGroupSpecs({ snapshot: SNAPSHOT, sharedCanisterIds: SHARED_IDS, testedLimits: LIMITS });
    const g2 = groups.find((g) => g.id === 'g2')!;
    expect(g2.accepting).toBe(true);
    expect(g2.maxClubs).toBe(100);
    expect(g2.photoStoreId).toBe('g2-store-cai');
    expect(g2.canisters.map((c) => c.key)).toEqual(['club_domain', 'events_domain']);
    expect(g2.testedLimitBytes).toEqual({});
  });

  it('handles a null snapshot (shared group only)', () => {
    const { groups } = buildGroupSpecs({ snapshot: null, sharedCanisterIds: SHARED_IDS, testedLimits: LIMITS });
    expect(groups.map((g) => g.id)).toEqual(['g1']);
  });
});

describe('parseApprovedConfiguration', () => {
  it('returns [] on missing or invalid JSON instead of guessing policy', () => {
    expect(parseApprovedConfiguration(undefined)).toEqual([]);
    expect(parseApprovedConfiguration('not json')).toEqual([]);
    expect(parseApprovedConfiguration('{"id":"g2"}')).toEqual([]);
  });
});

describe('computeGroupRollup', () => {
  const spec: GroupSpec = {
    id: 'g1',
    label: 'Group 1',
    accepting: null,
    maxClubs: null,
    canisters: [
      { key: 'club_domain', canisterId: 'a' },
      { key: 'events_domain', canisterId: 'b' },
    ],
    photoStoreId: null,
    testedLimitBytes: { club_domain: 1_000_000_000, events_domain: 1_000_000_000 },
  };
  const reading = (key: string, memoryBytes: number | null, cyclesT: number | null, error: string | null = null): CanisterReading => ({
    key,
    canisterId: key,
    memoryBytes,
    cyclesT,
    clubs: null,
    error,
  });

  it('sums memory and tested limits and takes the lowest fuel', () => {
    const rollup = computeGroupRollup([reading('club_domain', 500_000_000, 2.5), reading('events_domain', 250_000_000, 1.5)], spec);
    expect(rollup.memoryBytes).toBe(750_000_000);
    expect(rollup.testedLimitBytes).toBe(2_000_000_000);
    expect(rollup.memoryPct).toBeCloseTo(37.5);
    expect(rollup.minCyclesT).toBe(1.5);
    expect(rollup.unreadable).toEqual([]);
  });

  it('lists unreadable canisters instead of counting them as zero', () => {
    const rollup = computeGroupRollup([reading('club_domain', 500_000_000, 2.5), reading('events_domain', null, null, 'timeout')], spec);
    expect(rollup.unreadable).toEqual(['events_domain']);
    expect(rollup.memoryBytes).toBe(500_000_000);
  });

  it('reports no percentage when no tested limits exist', () => {
    const noLimits: GroupSpec = { ...spec, testedLimitBytes: {} };
    const rollup = computeGroupRollup([reading('club_domain', 500_000_000, 2.5), reading('events_domain', 1, 2)], noLimits);
    expect(rollup.testedLimitBytes).toBeNull();
    expect(rollup.memoryPct).toBeNull();
  });
});
