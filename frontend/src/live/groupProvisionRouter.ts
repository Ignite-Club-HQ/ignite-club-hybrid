/** Records a provisioned group in the shard router (directory) canister.
 * Registered not-accepting first, then its immutable deployment placement, and
 * only then switched to accepting new clubs. Every call is a revision CAS, so a
 * concurrent registry change stops the step instead of overwriting it. Global
 * services (workload identity) point at the shared canister, never a copy. */
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
import { ProvisionRefusedError, type Provision, type ProvisionCheckpoint } from './groupProvisioner';

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
  if (p.deploymentId !== dep.deploymentId) throw new Error('Provision belongs to another deployment');
  const host = new URL(dep.host);
  if (host.protocol !== 'https:' || host.username || host.password || host.search || host.hash) throw new Error('Invalid deployment HTTPS host');
  if (!dep.approvedSubnets.includes(dep.primarySubnet) || !dep.approvedSubnets.includes(p.subnetId) || (!dep.additionalSubnetsEnabled && p.subnetId !== dep.primarySubnet)) throw new Error('Unapproved group subnet');
  const domains = GROUP_DOMAINS.map(d => {
    const id = d === 'secret_workload_identity' ? globals.secret_workload_identity : p.canisters[d];
    if (!id) throw new Error(`Group ${p.groupId} missing ${d}`);
    return { domain: d, canister: Principal.fromText(id) };
  });
  if (new Set(domains.map(d => d.canister.toText())).size !== domains.length) throw new Error('Duplicate group canister');
  // A group opens only with its own installed photo store (never a shared one).
  const photoStore = p.dedicatedBlobStore?.installed ? p.dedicatedBlobStore.canisterId : undefined;
  if (accepting && !photoStore && dep.deploymentId !== 'local') throw new Error(`Group ${p.groupId} cannot open without its own photo store`);
  if (photoStore && domains.some(d => d.canister.toText() === photoStore)) throw new Error('Photo store duplicates a group service');
  return {
    group: { id: p.groupId, target_alias: dep.targetAlias, domains, accepting, max_clubs: limits.maxClubs, assigned_clubs: 0,
      heap_budget_bytes: limits.heapBudgetBytes, heap_bytes: 0n, min_cycles: limits.minCycles, cycles: 0n, observed_at_ns: 0n,
      photo_store: photoStore ? [Principal.fromText(photoStore)] : [] },
    placement: { group_id: p.groupId, deployment_id: dep.deploymentId, deployment_revision: dep.deploymentRevision, host: dep.host,
      network_kind: dep.networkKind, primary_subnet: Principal.fromText(dep.primarySubnet), approved_subnets: dep.approvedSubnets.map(s => Principal.fromText(s)),
      additional_subnets_enabled: dep.additionalSubnetsEnabled,
      domains: domains.map(d => ({ ...d, subnet: Principal.fromText(d.domain === 'secret_workload_identity' ? dep.primarySubnet : p.subnetId) })) },
  };
}

/** Adapter pieces for runProvision: readRegistryRevision / registerGroup / enableGroup. */
export function routerProvisionSteps(router: RouterActor, globals: { secret_workload_identity: string }, dep: DeploymentInfo, limits: GroupLimits,
  wireAuthorities?: (provision: Provision) => Promise<void>, localRehearsal = false) {
  return {
    readRegistryRevision: () => router.version(),
    registerGroup: async (p: Provision, checkpoint: ProvisionCheckpoint = async () => {}) => {
      const { group, placement } = routerGroupRecord(p, globals, dep, limits, false);
      const mutate = async (kind: 'register' | 'placement', call: () => Promise<Res<bigint>>) => {
        p = { ...p, pending: { kind } }; await checkpoint(p);
        const result = await call();
        if ('Err' in result) { p = { ...p, pending: undefined }; await checkpoint(p); throw new ProvisionRefusedError(`${kind}: ${result.Err}`); }
        return result.Ok;
      };
      if (!p.registration) {
        const r1 = await mutate('register', () => router.register_group(group, p.expectedRevision));
        p = { ...p, pending: undefined, registration: { closedRevision: r1 } }; await checkpoint(p);
      }
      const registration = p.registration;
      if (!registration) throw new Error('Missing closed registration receipt');
      if (registration.placementRevision === undefined) {
        const r2 = await mutate('placement', () => router.register_group_placement(placement, registration.closedRevision));
        p = { ...p, pending: undefined, registration: { ...registration, placementRevision: r2 } }; await checkpoint(p);
      }
    },
    enableGroup: async (p: Provision, checkpoint: ProvisionCheckpoint = async () => {}) => {
      if (!localRehearsal || dep.targetAlias !== 'local' || dep.deploymentId !== 'local') throw new Error('New-group activation awaits account revocation verification');
      if (!wireAuthorities) throw new Error('Complete account authority wiring required before group activation');
      await wireAuthorities(p);
      const { group } = routerGroupRecord(p, globals, dep, limits, true);
      const revision = p.registration?.placementRevision;
      if (revision === undefined || await router.version() !== revision) throw new Error('Missing or changed placement receipt');
      await checkpoint({ ...p, pending: { kind: 'enable' } });
      const result = await router.register_group(group, revision);
      if ('Err' in result) await checkpoint({ ...p, pending: undefined });
      ok(result, 'Enable group');
    },
  };
}
