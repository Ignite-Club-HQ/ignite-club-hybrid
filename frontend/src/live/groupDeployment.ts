/** Deployment-bound routing preparation. No actors, credentials or activation.
 * Both tables and approvals must come from the verified control plane, not UI input.
 */
import { GROUP_DOMAINS, resolveClubDomain, type GroupDomain, type GroupRoutingTable } from './groupRouting';

export type GroupDeployment = {
  id: string;
  alias: string;
  networkKind: 'public_mainnet' | 'cloud_engine';
  host: string;
  revision: bigint;
  enabled: boolean;
  /** Explicit operator gate; absent/false permits only the primary subnet. */
  additionalSubnetsEnabled: boolean;
  primarySubnet: string;
  approvedSubnets: readonly string[];
};
export type GroupDeploymentBinding = {
  groupId: string;
  deploymentId: string;
  deploymentRevision: bigint;
  /** Verified placement per domain permits independent domain expansion. */
  domains: readonly { domain: GroupDomain; canisterId: string; subnetId: string }[];
};
export type DeploymentBoundTable = {
  routing: GroupRoutingTable;
  deployments: ReadonlyMap<string, GroupDeployment>;
  bindings: ReadonlyMap<string, GroupDeploymentBinding>;
};

function endpoint(host: string): string {
  const url = new URL(host);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Deployment host must be an HTTPS origin');
  }
  return url.origin;
}

export function resolveDeploymentClubDomain(
  table: DeploymentBoundTable,
  approved: GroupDeployment,
  clubId: string,
  domain: GroupDomain,
) {
  const registered = table.deployments.get(approved.id);
  if (!registered || !registered.enabled || !approved.enabled || registered.id !== approved.id ||
      registered.alias !== approved.alias || registered.networkKind !== approved.networkKind ||
      registered.revision !== approved.revision || registered.revision < 1n ||
      endpoint(registered.host) !== endpoint(approved.host) ||
      registered.primarySubnet !== approved.primarySubnet ||
      registered.additionalSubnetsEnabled !== approved.additionalSubnetsEnabled ||
      !['public_mainnet', 'cloud_engine'].includes(registered.networkKind)) {
    throw new Error('Missing, stale or mismatched approved deployment');
  }
  const subnets = new Set(registered.approvedSubnets);
  if (!registered.primarySubnet || subnets.size !== registered.approvedSubnets.length ||
      !subnets.has(registered.primarySubnet) || subnets.size !== new Set(approved.approvedSubnets).size ||
      approved.approvedSubnets.some(subnet => !subnets.has(subnet))) {
    throw new Error('Invalid approved subnet registry');
  }
  const route = resolveClubDomain(table.routing, registered.alias, clubId, domain);
  const binding = table.bindings.get(route.groupId);
  const group = table.routing.groups.get(route.groupId);
  if (!binding || !group || binding.groupId !== route.groupId || binding.deploymentId !== registered.id ||
      binding.deploymentRevision !== registered.revision || binding.domains.length !== GROUP_DOMAINS.length) {
    throw new Error('Missing or stale deployment binding');
  }
  const seen = new Set<GroupDomain>();
  for (const entry of binding.domains) {
    if (seen.has(entry.domain) || !GROUP_DOMAINS.includes(entry.domain) ||
        group.domains.find(item => item.domain === entry.domain)?.canisterId !== entry.canisterId ||
        !subnets.has(entry.subnetId) ||
        (!registered.additionalSubnetsEnabled && entry.subnetId !== registered.primarySubnet)) {
      throw new Error('Unapproved group domain placement');
    }
    seen.add(entry.domain);
  }
  const destination = binding.domains.find(entry => entry.domain === domain);
  if (!destination) throw new Error('Missing deployment destination');
  return {
    ...route,
    deploymentId: registered.id,
    deploymentRevision: registered.revision,
    networkKind: registered.networkKind,
    host: endpoint(registered.host),
    subnetId: destination.subnetId,
  };
}

/** Deployment and account isolate future actors/cache entries; no secrets in key. */
export function groupRouteScope(
  route: ReturnType<typeof resolveDeploymentClubDomain>,
  principal: string,
): string {
  if (!principal || principal === '2vxsx-fae') throw new Error('Authenticated account required');
  return JSON.stringify([
    route.deploymentId, route.deploymentRevision.toString(), route.networkKind,
    route.host, route.subnetId, route.groupId, route.canisterId,
    route.revision.toString(), principal,
  ]);
}