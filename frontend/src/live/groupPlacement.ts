/** Pure placement + provisioning planner (inactive). Inputs must come from a
 * verified control plane; output is a proposal an authorized operator applies. */
export const GIB = 1024 ** 3;
export const WATCH_BYTES = 2.5 * GIB;
export const ACT_BYTES = 3 * GIB;
export const MAX_CLUBS_PER_GROUP = 500;

export type GroupCapacity = {
  groupId: string; deploymentId: string; subnetId: string; enabled: boolean;
  clubs: number; maxDomainBytes: number; dailyGrowthBytes: number;
};
export type PlacementPolicy = {
  deploymentId: string; primarySubnet: string; additionalSubnetsEnabled: boolean; approvedSubnets: string[];
  /** Engine-assigned countries must never land on another deployment. */
  requiredDeploymentId?: string;
};
export type PlacementDecision =
  | { kind: 'place'; groupId: string }
  | { kind: 'provision'; deploymentId: string; subnetId: string; reason: string };

const forecastDays = (g: GroupCapacity) => g.dailyGrowthBytes <= 0 ? Infinity : (ACT_BYTES - g.maxDomainBytes) / g.dailyGrowthBytes;

export function groupHealth(g: GroupCapacity): 'ok' | 'watch' | 'act' {
  const days = forecastDays(g);
  if (g.maxDomainBytes >= ACT_BYTES || days <= 30 || g.clubs >= MAX_CLUBS_PER_GROUP) return 'act';
  if (g.maxDomainBytes >= WATCH_BYTES || days <= 90) return 'watch';
  return 'ok';
}

export function placeNewClub(groups: GroupCapacity[], policy: PlacementPolicy): PlacementDecision {
  const deployment = policy.requiredDeploymentId ?? policy.deploymentId;
  if (policy.requiredDeploymentId && policy.requiredDeploymentId !== policy.deploymentId) throw new Error('Engine-assigned club cannot use this deployment');
  const allowedSubnets = new Set(policy.additionalSubnetsEnabled ? policy.approvedSubnets : [policy.primarySubnet]);
  const eligible = groups.filter(g => g.enabled && g.deploymentId === deployment && allowedSubnets.has(g.subnetId) && groupHealth(g) === 'ok')
    .sort((a, b) => a.clubs - b.clubs || a.maxDomainBytes - b.maxDomainBytes || a.groupId.localeCompare(b.groupId));
  if (eligible.length) return { kind: 'place', groupId: eligible[0].groupId };
  return { kind: 'provision', deploymentId: deployment, subnetId: chooseSubnet(groups, policy, allowedSubnets), reason: 'No group below capacity thresholds' };
}

function chooseSubnet(groups: GroupCapacity[], policy: PlacementPolicy, allowed: Set<string>): string {
  if (!policy.additionalSubnetsEnabled) return policy.primarySubnet;
  const load = new Map([...allowed].map(s => [s, 0]));
  for (const g of groups) if (load.has(g.subnetId)) load.set(g.subnetId, load.get(g.subnetId)! + 1);
  return [...load].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0][0];
}

/** Groups needing a new sibling before they hit the act threshold. */
export function provisioningAlerts(groups: GroupCapacity[]) {
  return groups.filter(g => g.enabled).map(g => ({ groupId: g.groupId, health: groupHealth(g), daysToAct: forecastDays(g) }))
    .filter(a => a.health !== 'ok');
}
