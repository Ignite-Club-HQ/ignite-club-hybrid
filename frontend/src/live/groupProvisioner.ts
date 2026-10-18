/** Operator-approved group provisioning executor (inactive tooling). Applies a
 * `provision` proposal from groupPlacement: create every per-group canister on
 * the proposed subnet, install, health-check, then register the group in the
 * router with a revision compare-and-swap, and only then enable it. Persists
 * after every step so a crash resumes; a partially built group is never
 * registered or enabled. Global services are never created per group. */
import { GROUP_DOMAINS, type GroupDomain } from './groupRouting';
import type { PlacementDecision } from './groupPlacement';

export const PER_GROUP_DOMAINS = GROUP_DOMAINS.filter(d => d !== 'secret_workload_identity') as GroupDomain[];
export type ProvisionPhase = 'approved' | 'created' | 'installed' | 'checked' | 'registered' | 'enabled' | 'failed';
export type Provision = {
  id: string; groupId: string; deploymentId: string; subnetId: string; phase: ProvisionPhase;
  canisters: Partial<Record<GroupDomain, string>>; expectedRevision: bigint; error?: string;
};
export type ProvisionAdapter = {
  createCanister(p: Provision, domain: GroupDomain): Promise<{ canisterId: string; subnetId: string }>;
  install(p: Provision, domain: GroupDomain, canisterId: string): Promise<void>;
  healthy(p: Provision, domain: GroupDomain, canisterId: string): Promise<boolean>;
  readRegistryRevision(): Promise<bigint>;
  registerGroup(p: Provision): Promise<void>; // router CAS on expectedRevision, registered disabled
  enableGroup(p: Provision): Promise<void>;
  save(p: Provision): Promise<void>;
};
export type OperatorApproval = { operator: string; proposalId: string; deploymentId: string; subnetId: string };

export function approveProvision(d: PlacementDecision, a: OperatorApproval, groupId: string, revision: bigint): Provision {
  if (d.kind !== 'provision') throw new Error('Nothing to provision');
  if (!a.operator) throw new Error('Operator approval required');
  if (a.deploymentId !== d.deploymentId || a.subnetId !== d.subnetId) throw new Error('Approval does not match proposal');
  if (!/^[a-z0-9-]{1,32}$/.test(groupId)) throw new Error('Invalid group id');
  return { id: a.proposalId, groupId, deploymentId: d.deploymentId, subnetId: d.subnetId, phase: 'approved', canisters: {}, expectedRevision: revision };
}

export async function runProvision(start: Provision, a: ProvisionAdapter): Promise<Provision> {
  let p = start;
  const step = async (n: Provision) => { await a.save(n); p = n; };
  if (p.phase === 'failed' || p.phase === 'enabled') return p;
  try {
    if (p.phase === 'approved') {
      for (const d of PER_GROUP_DOMAINS) {
        if (p.canisters[d]) continue; // resume: never create twice
        const c = await a.createCanister(p, d);
        if (c.subnetId !== p.subnetId) throw new Error(`${d} landed on unapproved subnet ${c.subnetId}`);
        await step({ ...p, canisters: { ...p.canisters, [d]: c.canisterId } });
      }
      await step({ ...p, phase: 'created' });
    }
    if (p.phase === 'created') { for (const d of PER_GROUP_DOMAINS) await a.install(p, d, p.canisters[d]!); await step({ ...p, phase: 'installed' }); }
    if (p.phase === 'installed') {
      for (const d of PER_GROUP_DOMAINS) if (!(await a.healthy(p, d, p.canisters[d]!))) throw new Error(`${d} failed health check`);
      await step({ ...p, phase: 'checked' });
    }
    if (p.phase === 'checked') {
      if ((await a.readRegistryRevision()) !== p.expectedRevision) throw new Error('Registry changed since approval; re-approve');
      await a.registerGroup(p); await step({ ...p, phase: 'registered' });
    }
    if (p.phase === 'registered') { await a.enableGroup(p); await step({ ...p, phase: 'enabled' }); }
    return p;
  } catch (e) {
    // Pre-registration failures stay unregistered; created canisters are kept for operator review.
    if (p.phase === 'registered') throw e; // registered-but-disabled: safe to resume enable
    await step({ ...p, phase: 'failed', error: e instanceof Error ? e.message : String(e) });
    return p;
  }
}
