/** Exact, deployment-bound commitments; never derived from club counts or
 * monthly counters. Admission tooling only, not authority to open a group. */
import { CAPACITY_READING_MAX_AGE_MS } from './groupCapacityPolicy';

export type GrowthCommitment = {
  clubId: string; finalizedBytes: number; pendingBytes: number;
  /** Tested physical budget, including allocator overhead and allowed growth. */
  committedBytes: number;
};
export type GroupGrowthEvidence = {
  deploymentId: string; groupId: string; observedAtMs: number; revision: string;
  inventoryComplete: boolean; expectedClubIds: string[];
  /** Tested physical upload-admission capacity, not the configured ceiling. */
  usableBytes: number; unassignedBytes: number; clubs: GrowthCommitment[];
};
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
  return Number.isSafeInteger(additionalBytes) && additionalBytes >= 0 && headroom !== null && headroom >= additionalBytes;
}