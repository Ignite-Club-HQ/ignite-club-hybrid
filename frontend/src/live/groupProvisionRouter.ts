/** Records a provisioned group in the shard router (directory) canister.
 * Registered not-accepting first, then its immutable deployment placement, and
 * only then switched to accepting new clubs. Every call is a revision CAS, so a
 * concurrent registry change stops the step instead of overwriting it. Global
 * services (workload identity) point at the shared canister, never a copy. */
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
import type { Provision } from './groupProvisioner';

type Res<T> = { Ok: T } | { Err: string };
export type RouterActor = {
  version(): Promise<bigint>;
  register_group(g: unknown, rev: bigint): Promise<Res<bigint>>;
  register_group_placement(p: unknown, rev: bigint): Promise<Res<bigint>>;
};
export type GroupLimits = { maxClubs: number; heapBudgetBytes: bigint; minCycles: bigint };
export type DeploymentInfo = { targetAlias: string; deploymentId: string; deploymentRevision: bigint; host: string; networkKind: string;
  primarySubnet: string; approvedSubnets: string[]; additionalSubnetsEnabled: boolean };
const ok = <T>(r: Res<T>, what: string): T => { if ('Err' in r) throw new Error(`${what}: ${r.Err}`); return r.Ok; };

export function routerGroupRecord(p: Provision, globals: { secret_workload_identity: string }, dep: DeploymentInfo, limits: GroupLimits, accepting: boolean) {
  const domains = GROUP_DOMAINS.map(d => {
    const id = d === 'secret_workload_identity' ? globals.secret_workload_identity : p.canisters[d];
    if (!id) throw new Error(`Group ${p.groupId} missing ${d}`);
    return { domain: d, canister: Principal.fromText(id) };
  });
  return {
    group: { id: p.groupId, target_alias: dep.targetAlias, domains, accepting, max_clubs: limits.maxClubs, assigned_clubs: 0,
      heap_budget_bytes: limits.heapBudgetBytes, heap_bytes: 0n, min_cycles: limits.minCycles, cycles: 0n, observed_at_ns: 0n },
    placement: { group_id: p.groupId, deployment_id: dep.deploymentId, deployment_revision: dep.deploymentRevision, host: dep.host,
      network_kind: dep.networkKind, primary_subnet: Principal.fromText(dep.primarySubnet), approved_subnets: dep.approvedSubnets.map(s => Principal.fromText(s)),
      additional_subnets_enabled: dep.additionalSubnetsEnabled,
      domains: domains.map(d => ({ ...d, subnet: Principal.fromText(d.domain === 'secret_workload_identity' ? dep.primarySubnet : p.subnetId) })) },
  };
}

/** Adapter pieces for runProvision: readRegistryRevision / registerGroup / enableGroup. */
export function routerProvisionSteps(router: RouterActor, globals: { secret_workload_identity: string }, dep: DeploymentInfo, limits: GroupLimits,
  wireAuthorities?: (provision: Provision) => Promise<void>) {
  return {
    readRegistryRevision: () => router.version(),
    registerGroup: async (p: Provision) => {
      const { group, placement } = routerGroupRecord(p, globals, dep, limits, false);
      const r1 = ok(await router.register_group(group, p.expectedRevision), 'Register group');
      ok(await router.register_group_placement(placement, r1), 'Register placement');
    },
    enableGroup: async (p: Provision) => {
      if (!wireAuthorities) throw new Error('Complete account authority wiring required before group activation');
      await wireAuthorities(p);
      const { group } = routerGroupRecord(p, globals, dep, limits, true);
      ok(await router.register_group(group, await router.version()), 'Enable group');
    },
  };
}
