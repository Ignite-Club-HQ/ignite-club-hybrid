/** Closed request queue only: no install, registration, opening or migration. */
import { capacityPercent, PREPARE_PERCENT } from './groupCapacityPolicy';
import { placeNewClub, type GroupCapacity, type PlacementPolicy } from './groupPlacement';
export type ClosedPreparationRequest = {
  id: string; deploymentId: string; sourceGroupId: string; subnetId: string;
  status: 'requested-closed'; opening: 'operator-approval-and-release-checks-required';
  observedAtMs: number; percent: number;
};
export function prepareCapacityRequests(groups: GroupCapacity[], policy: PlacementPolicy,
  existing: ClosedPreparationRequest[] = []): { requests: ClosedPreparationRequest[]; blocked: string[] } {
  const now = policy.nowMs ?? Date.now();
  const current = groups.find(g => g.groupId === policy.currentGroupId && g.deploymentId === policy.deploymentId);
  if (!current) return { requests: existing, blocked: ['Current group missing from verified inventory'] };
  const percent = capacityPercent(current.capacity, policy.deploymentId, now);
  if (percent === null) return { requests: existing, blocked: ['Fresh complete tested-capacity evidence required'] };
  if (current.cyclesHealthy !== true) return { requests: existing, blocked: ['Top up cycles; fuel is not a capacity trigger'] };
  if (percent < PREPARE_PERCENT) return { requests: existing, blocked: [] };
  if (existing.some(r => r.deploymentId === policy.deploymentId) || groups.some(g =>
    g.groupId !== current.groupId && g.deploymentId === policy.deploymentId && g.ready === true &&
    placeNewClub([g], policy).kind === 'place')) return { requests: existing, blocked: [] };
  const decision = placeNewClub([], policy);
  if (decision.kind !== 'provision') throw new Error('Expected closed proposal');
  return { requests: [...existing, {
    id: `capacity:${policy.deploymentId}:${current.groupId}`, deploymentId: policy.deploymentId,
    sourceGroupId: current.groupId, subnetId: decision.subnetId, status: 'requested-closed',
    opening: 'operator-approval-and-release-checks-required', observedAtMs: now, percent,
  }], blocked: [] };
}
