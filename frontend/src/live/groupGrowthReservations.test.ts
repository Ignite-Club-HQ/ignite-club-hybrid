import { describe, expect, it } from 'vitest';
import { growthHeadroom, canCommitGrowth, storeGrowthHeadroom, type GroupGrowthEvidence } from './groupGrowthReservations';
import { placeNewClub, type GroupCapacity, type PlacementPolicy } from './groupPlacement';
const now = 1_800_000_000_000;
const evidence: GroupGrowthEvidence = {
  deploymentId: 'mainnet', groupId: 'g1', observedAtMs: now, revision: 'r1', inventoryComplete: true,
  expectedClubIds: ['a', 'b'], usableBytes: 10 * 1024 ** 3, unassignedBytes: 0,
  clubs: ['a', 'b'].map(clubId => ({ clubId, finalizedBytes: 100, pendingBytes: 10, committedBytes: 5_368_709_120 })),
  expectedStoreIds: ['s1'], stores: [{ storeId: 's1', revision: 'r1', inventoryComplete: true,
    measuredUsableBytes: 16_777_216 * 960, unavailableBytes: 0, maxObjectSlotBytes: 16_777_216,
    promisedObjectSlots: 640, allocatableObjectSlots: 960, allocatedBytes: 0, pendingSlotBytes: 0 }],
};
describe('existing-club growth commitments', () => {
  it('two existing 5 GiB commitments leave no room for another club despite almost empty storage', () => {
    expect(growthHeadroom(evidence, 'mainnet', 'g1', now)).toBe(0);
    expect(canCommitGrowth(evidence, 'mainnet', 'g1', now, 1)).toBe(false);
  });
  it('permits exactly the remaining commitment and refuses one byte more', () => {
    const larger = { ...evidence, usableBytes: 11 * 1024 ** 3 };
    expect(canCommitGrowth(larger, 'mainnet', 'g1', now, 1024 ** 3)).toBe(true);
    expect(canCommitGrowth(larger, 'mainnet', 'g1', now, 1024 ** 3 + 1)).toBe(false);
  });
  it('rejects incomplete, duplicate, stale and wrong-group inventory', () => {
    expect(growthHeadroom({ ...evidence, inventoryComplete: false }, 'mainnet', 'g1', now)).toBeNull();
    expect(growthHeadroom({ ...evidence, clubs: [evidence.clubs[0], evidence.clubs[0]] }, 'mainnet', 'g1', now)).toBeNull();
    expect(growthHeadroom(evidence, 'mainnet', 'g2', now)).toBeNull();
    expect(growthHeadroom(evidence, 'mainnet', 'g1', now + 900_001)).toBeNull();
  });
  it('refuses commitments below bytes already stored or uploading', () => {
    expect(growthHeadroom({ ...evidence, clubs: evidence.clubs.map(c => ({ ...c, committedBytes: 109 })) }, 'mainnet', 'g1', now)).toBeNull();
  });
  it('rejects aggregate-only, incomplete and duplicate store proof', () => {
    expect(canCommitGrowth({ ...evidence, usableBytes: 20 * 1024 ** 3, stores: undefined }, 'mainnet', 'g1', now, 1)).toBe(false);
    expect(storeGrowthHeadroom({ ...evidence, expectedStoreIds: ['s1', 's2'] })).toBeNull();
    expect(storeGrowthHeadroom({ ...evidence, stores: [evidence.stores?.[0], evidence.stores?.[0]].filter(s => s !== undefined) })).toBeNull();
  });
  it('refuses fragmented free bytes with no allocatable maximum-size roots', () => {
    const stores = evidence.stores?.map(s => ({ ...s, promisedObjectSlots: 0, allocatableObjectSlots: 0 }));
    expect(canCommitGrowth({ ...evidence, usableBytes: 20 * 1024 ** 3, stores }, 'mainnet', 'g1', now, 1)).toBe(false);
  });
  it('counts pending physical slots and rejects impossible allocatable evidence', () => {
    expect(storeGrowthHeadroom({ ...evidence, stores: evidence.stores?.map(s => ({ ...s, pendingSlotBytes: 1 })) })).toBeNull();
    expect(storeGrowthHeadroom({ ...evidence, stores: evidence.stores?.map(s => ({ ...s, promisedObjectSlots: 961 })) })).toBeNull();
  });
  it('does not combine undersized promises across separate stores', () => {
    const stores = ['s1', 's2'].map(storeId => ({ storeId, revision: 'r1', inventoryComplete: true,
      measuredUsableBytes: 16_777_216, unavailableBytes: 0, maxObjectSlotBytes: 16_777_216,
      promisedObjectSlots: 0, allocatableObjectSlots: 1, allocatedBytes: 0, pendingSlotBytes: 0 }));
    expect(canCommitGrowth({ ...evidence, usableBytes: 20 * 1024 ** 3, expectedStoreIds: ['s1', 's2'], stores }, 'mainnet', 'g1', now, 16_777_217)).toBe(false);
  });
  it('blocks new-club placement when required commitments are missing or full', () => {
    const group: GroupCapacity = { groupId: 'g1', deploymentId: 'mainnet', subnetId: 's1', enabled: true, ready: true, cyclesHealthy: true,
      clubs: 2, maxDomainBytes: 100, dailyGrowthBytes: 0, capacity: { deploymentId: 'mainnet', observedAtMs: now,
        requiredResources: ['media'], readings: [{ resource: 'media', used: 100, testedLimit: 1000, evidence: 'signed' }] } };
    const policy: PlacementPolicy = { deploymentId: 'mainnet', primarySubnet: 's1', additionalSubnetsEnabled: false, approvedSubnets: ['s1'],
      nowMs: now, requiredNewClubBytes: 5_368_709_120 };
    expect(placeNewClub([group], policy).kind).toBe('provision');
    expect(placeNewClub([{ ...group, growth: evidence }], policy).kind).toBe('provision');
    expect(placeNewClub([{ ...group, growth: { ...evidence, usableBytes: 15 * 1024 ** 3 } }], policy).kind).toBe('place');
  });
});