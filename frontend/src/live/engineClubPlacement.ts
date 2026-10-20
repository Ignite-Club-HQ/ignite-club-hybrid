/** Offline placement planning only. Country settings never rewrite an existing
 * assignment or authorize router mutations. Production dispatch stays unchanged. */
import { isValidCountryCode } from '../lib/countries';
import { resolveDeploymentClubDomain, type DeploymentBoundTable, type GroupDeployment } from './groupDeployment';
import { placeNewClub, type GroupCapacity, type PlacementPolicy } from './groupPlacement';

export type ClubPlacementPlan =
  | { kind: 'existing'; groupId: string; deploymentId: string; revision: bigint; host: string }
  | { kind: 'new'; groupId: string; deploymentId: string; country: string; registryRevision: bigint; authorityRequired: true }
  | { kind: 'blocked'; deploymentId?: string; reason: string };
export type CountryDeploymentPlan = {
  revision: bigint;
  countryDeployments: ReadonlyMap<string, string>;
};

export function planClubPlacement(input: {
  clubId: string; homeCountry: string; countries: CountryDeploymentPlan;
  table: DeploymentBoundTable; groups: GroupCapacity[];
  policy: PlacementPolicy; approvedDeployments: ReadonlyMap<string, GroupDeployment>;
}): ClubPlacementPlan {
  const { table } = input;
  if (!input.clubId.trim() || input.countries.revision < 1n) throw new Error('Club ID and authoritative country revision required');
  const assignment = table.routing.assignments.get(input.clubId);
  if (assignment) {
    const binding = table.bindings.get(assignment.groupId);
    const approved = binding && input.approvedDeployments.get(binding.deploymentId);
    if (!approved) throw new Error('Existing club deployment missing; never reassign by country');
    const route = resolveDeploymentClubDomain(table, approved, input.clubId, 'club_domain');
    return { kind: 'existing', groupId: route.groupId, deploymentId: route.deploymentId, revision: route.revision, host: route.host };
  }
  const country = input.homeCountry.trim().toUpperCase();
  if (!isValidCountryCode(country)) throw new Error('Valid club home country required');
  const deploymentId = input.countries.countryDeployments.get(country);
  if (!deploymentId) return { kind: 'blocked', reason: 'No explicit country deployment; no fallback permitted' };
  const approved = input.approvedDeployments.get(deploymentId);
  const registered = table.deployments.get(deploymentId);
  const fingerprint = (d: GroupDeployment) => JSON.stringify([d.id, d.alias, d.networkKind, d.host,
    String(d.revision), d.enabled, d.additionalSubnetsEnabled, d.primarySubnet, [...d.approvedSubnets].sort()]);
  if (!approved || !registered || fingerprint(approved) !== fingerprint(registered) || !approved.enabled) {
    return { kind: 'blocked', deploymentId, reason: 'Missing, changed or disabled deployment approval' };
  }
  if (approved.networkKind === 'cloud_engine') return { kind: 'blocked', deploymentId, reason: 'Real Cloud Engine acceptance and release required; no mainnet fallback' };
  if (input.policy.deploymentId !== deploymentId || input.policy.primarySubnet !== approved.primarySubnet ||
      input.policy.additionalSubnetsEnabled !== approved.additionalSubnetsEnabled ||
      input.policy.approvedSubnets.length !== approved.approvedSubnets.length ||
      input.policy.approvedSubnets.some(s => !approved.approvedSubnets.includes(s))) {
    return { kind: 'blocked', deploymentId, reason: 'Placement policy differs from approved deployment' };
  }
  const decision = placeNewClub(input.groups, { ...input.policy, requiredDeploymentId: deploymentId });
  if (decision.kind !== 'place') return { kind: 'blocked', deploymentId, reason: decision.reason };
  // Use the existing whole-group resolver to reject partial/foreign inventories.
  const candidate: DeploymentBoundTable = { ...table, routing: { ...table.routing,
    assignments: new Map([...table.routing.assignments, [input.clubId, { clubId: input.clubId, groupId: decision.groupId, revision: input.countries.revision }]]) } };
  resolveDeploymentClubDomain(candidate, approved, input.clubId, 'club_domain');
  const group = table.routing.groups.get(decision.groupId);
  if (!group?.photoStore || group.domains.some(d => d.canisterId === group.photoStore)) throw new Error('Dedicated group photo store required');
  return { kind: 'new', groupId: decision.groupId, deploymentId, country, registryRevision: input.countries.revision, authorityRequired: true };
}