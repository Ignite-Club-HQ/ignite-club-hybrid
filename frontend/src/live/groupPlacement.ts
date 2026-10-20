/** Fill-first placement and closed preparation planning. Operator evidence is
 * mandatory; proposals never authorize opening or move existing assignments. */
import { capacityPercent, capacityState, ROLLOVER_PERCENT, type CapacityEvidence } from './groupCapacityPolicy';
import { canCommitGrowth, type GroupGrowthEvidence } from './groupGrowthReservations';
export const GIB = 1024 ** 3;
export const MAX_CLUBS_PER_GROUP = 500;

export type GroupCapacity = {
  groupId: string; deploymentId: string; subnetId: string; enabled: boolean;
  clubs: number; maxDomainBytes: number; dailyGrowthBytes: number;
  capacity?: CapacityEvidence;
  growth?: GroupGrowthEvidence;
  /** True only after operator approval and full readiness checks. */
  ready?: boolean;
  cyclesHealthy?: boolean;
};
export type PlacementPolicy = {
  deploymentId: string; primarySubnet: string; additionalSubnetsEnabled: boolean; approvedSubnets: string[];
  /** Engine-assigned countries must never land on another deployment. */
  requiredDeploymentId?: string;
  currentGroupId?: string;
  nowMs?: number;
  /** Required by production admission; omission preserves legacy offline planners. */
  requiredNewClubBytes?: number;
};
export type PlacementDecision =
  | { kind: 'place'; groupId: string }
  | { kind: 'provision'; deploymentId: string; subnetId: string; reason: string };

export function groupHealth(g: GroupCapacity, now = Date.now()) {
  return capacityState(capacityPercent(g.capacity, g.deploymentId, now));
}

export function placeNewClub(groups: GroupCapacity[], policy: PlacementPolicy): PlacementDecision {
  const deployment = policy.requiredDeploymentId ?? policy.deploymentId;
  if (policy.requiredDeploymentId && policy.requiredDeploymentId !== policy.deploymentId) throw new Error('Engine-assigned club cannot use this deployment');
  const allowedSubnets = new Set(policy.additionalSubnetsEnabled ? policy.approvedSubnets : [policy.primarySubnet]);
  const now = policy.nowMs ?? Date.now();
  const eligible = groups.filter(g => {
    const percent = capacityPercent(g.capacity, deployment, now);
    return g.enabled && g.ready === true && g.cyclesHealthy === true && g.deploymentId === deployment &&
      allowedSubnets.has(g.subnetId) && percent !== null && percent < ROLLOVER_PERCENT &&
      (policy.requiredNewClubBytes === undefined || canCommitGrowth(g.growth, deployment, g.groupId, now, policy.requiredNewClubBytes));
  }).sort((a, b) => {
    if (a.groupId === policy.currentGroupId) return -1;
    if (b.groupId === policy.currentGroupId) return 1;
    // Fill occupied groups first instead of spreading clubs into empty groups.
    return b.clubs - a.clubs || a.groupId.localeCompare(b.groupId);
  });
  if (eligible.length) return { kind: 'place', groupId: eligible[0].groupId };
  return { kind: 'provision', deploymentId: deployment, subnetId: chooseSubnet(groups, policy, allowedSubnets), reason: 'Creation blocked: no approved ready group below 80%; prepare capacity CLOSED' };
}

function chooseSubnet(groups: GroupCapacity[], policy: PlacementPolicy, allowed: Set<string>): string {
  if (!policy.additionalSubnetsEnabled) return policy.primarySubnet;
  const load = new Map([...allowed].map(s => [s, 0]));
  for (const g of groups) if (load.has(g.subnetId)) load.set(g.subnetId, (load.get(g.subnetId) ?? 0) + 1);
  const first = [...load].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
  if (!first) throw new Error('No approved subnet');
  return first[0];
}

/** Groups needing a new sibling before they hit the act threshold. */
export function provisioningAlerts(groups: GroupCapacity[], now = Date.now()) {
  return groups.filter(g => g.enabled).map(g => ({ groupId: g.groupId, health: groupHealth(g, now), percent: capacityPercent(g.capacity, g.deploymentId, now) }))
    .filter(a => a.health !== 'ok');
}
