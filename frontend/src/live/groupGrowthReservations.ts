/** Exact, deployment-bound commitments; never derived from club counts or
 * monthly counters. Admission tooling only, not authority to open a group. */
import { CAPACITY_READING_MAX_AGE_MS } from './groupCapacityPolicy';

export type GrowthCommitment = {
  clubId: string; finalizedBytes: number; pendingBytes: number;
  /** Tested physical budget, including allocator overhead and allowed growth. */
  committedBytes: number;
};
/** Conservative promise: each possible object owns a whole maximum-size
 * buddy root, including temporarily coexisting replacements. Small-file
 * slack cannot be sold again. This is evidence only, never a live flag. */
export type StoreGrowthEvidence = {
  storeId: string; revision: string; inventoryComplete: boolean;
  measuredUsableBytes: number; unavailableBytes: number;
  maxObjectSlotBytes: number; promisedObjectSlots: number;
  /** Slots guaranteed by the allocator, excluding live/held/unusable roots. */
  allocatableObjectSlots: number;
  allocatedBytes: number; pendingSlotBytes: number;
};
export type GroupGrowthEvidence = {
  deploymentId: string; groupId: string; observedAtMs: number; revision: string;
  inventoryComplete: boolean; expectedClubIds: string[];
  /** Tested physical upload-admission capacity, not the configured ceiling. */
  usableBytes: number; unassignedBytes: number; clubs: GrowthCommitment[];
  /** Exact complete store set; aggregate commitments cannot replace this. */
  expectedStoreIds?: string[]; stores?: StoreGrowthEvidence[];
};
export function storeGrowthHeadroom(e: GroupGrowthEvidence): number | null {
  if (!e.stores?.length || !e.expectedStoreIds?.length) return null;
  const expected = new Set(e.expectedStoreIds);
  const actual = new Set(e.stores.map(s => s.storeId));
  if (expected.size !== e.expectedStoreIds.length || actual.size !== e.stores.length || expected.size !== actual.size ||
    [...expected].some(id => !id.trim() || !actual.has(id))) return null;
  let headroom = 0;
  for (const store of e.stores) {
    const values = [store.measuredUsableBytes, store.unavailableBytes, store.maxObjectSlotBytes,
      store.promisedObjectSlots, store.allocatableObjectSlots, store.allocatedBytes, store.pendingSlotBytes];
    if (!store.inventoryComplete || !store.revision.trim() || values.some(n => !Number.isSafeInteger(n) || n < 0) ||
      store.measuredUsableBytes === 0 || store.maxObjectSlotBytes !== 16_777_216) return null;
    const available = store.measuredUsableBytes - store.unavailableBytes - store.allocatedBytes - store.pendingSlotBytes;
    const roots = store.allocatableObjectSlots * store.maxObjectSlotBytes;
    const promised = store.promisedObjectSlots * store.maxObjectSlotBytes;
    if (![available, roots, promised].every(Number.isSafeInteger) || available < roots ||
      store.promisedObjectSlots > store.allocatableObjectSlots) return null;
    headroom += roots - promised;
    if (!Number.isSafeInteger(headroom)) return null;
  }
  return headroom;
}
export function growthHeadroom(e: GroupGrowthEvidence | undefined, deploymentId: string, groupId: string, now: number): number | null {
  if (!e || e.deploymentId !== deploymentId || e.groupId !== groupId || !e.inventoryComplete || !e.revision.trim() ||
    !Number.isFinite(now) || !Number.isFinite(e.observedAtMs) || e.observedAtMs > now || now - e.observedAtMs > CAPACITY_READING_MAX_AGE_MS ||
    !Number.isSafeInteger(e.usableBytes) || e.usableBytes <= 0 || !Number.isSafeInteger(e.unassignedBytes) || e.unassignedBytes < 0) return null;
  const expected = new Set(e.expectedClubIds);
  const actual = new Set(e.clubs.map(c => c.clubId));
  if (expected.size !== e.expectedClubIds.length || actual.size !== e.clubs.length || actual.size !== expected.size ||
    [...expected].some(id => !id.trim() || !actual.has(id))) return null;
  let committed = e.unassignedBytes;
  for (const club of e.clubs) {
    if ([club.finalizedBytes, club.pendingBytes, club.committedBytes].some(n => !Number.isSafeInteger(n) || n < 0) ||
      club.committedBytes < club.finalizedBytes + club.pendingBytes) return null;
    committed += club.committedBytes;
    if (!Number.isSafeInteger(committed)) return null;
  }
  return e.usableBytes - committed;
}

export function canCommitGrowth(e: GroupGrowthEvidence | undefined, deploymentId: string, groupId: string, now: number, additionalBytes: number): boolean {
  const headroom = growthHeadroom(e, deploymentId, groupId, now);
  const physical = e ? storeGrowthHeadroom(e) : null;
  // One store must cover the entire new promise: scattered spare space in
  // different stores cannot stand in for a placeable per-store allocation.
  const fitsStore = e?.stores?.some(s => (s.allocatableObjectSlots - s.promisedObjectSlots) * s.maxObjectSlotBytes >= additionalBytes) ?? false;
  return Number.isSafeInteger(additionalBytes) && additionalBytes >= 0 && headroom !== null && headroom >= additionalBytes &&
    physical !== null && physical >= additionalBytes && fitsStore;
}