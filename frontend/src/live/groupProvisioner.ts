/** Operator-approved group provisioning executor (inactive tooling). Applies a
 * `provision` proposal from groupPlacement: create every per-group canister on
 * the proposed subnet, install, health-check, then register the group in the
 * router with a revision compare-and-swap, and only then enable it. Persists
 * after every step so a crash resumes; a partially built group is never
 * registered or enabled. Global services are never created per group. */
import { GROUP_DOMAINS, type GroupDomain } from './groupRouting';
import type { PlacementDecision } from './groupPlacement';

export const PER_GROUP_DOMAINS = GROUP_DOMAINS.filter(d => d !== 'secret_workload_identity') as GroupDomain[];
export type ProvisionPhase = 'approved' | 'created' | 'installed' | 'configured' | 'checked' | 'registered' | 'enabled' | 'failed';
export type Provision = {
  id: string; groupId: string; deploymentId: string; subnetId: string; phase: ProvisionPhase;
  canisters: Partial<Record<GroupDomain, string>>; expectedRevision: bigint; error?: string;
  pending?: { kind: 'create' | 'install' | 'configure' | 'register' | 'placement' | 'enable'; domain?: GroupDomain; operation?: string };
  configuration?: { binding: string; completed: string[] };
  installedDomains?: GroupDomain[];
  observedSubnets?: Partial<Record<GroupDomain, string>>;
  registration?: { closedRevision: bigint; placementRevision?: bigint };
  /** Group-owned photo store; never the live shared store (its single club authority would be repointed). */
  dedicatedBlobStore?: { canisterId?: string; createOperation?: string; subnetId?: string; installed?: boolean };
};
export type ProvisionCheckpoint = (p: Provision) => Promise<void>;
/** A directory returned a definite refusal: no mutation committed. */
export class ProvisionRefusedError extends Error {}
export type ProvisionAdapter = {
  /** Receives the durable intent record; repeating it with the same intent must be idempotent. */
  createCanister(p: Provision, domain: GroupDomain): Promise<{ canisterId: string; subnetId: string }>;
  /** Optional idempotency token persisted in the create intent before the call. */
  createOperation?(p: Provision, domain: GroupDomain): string;
  install(p: Provision, domain: GroupDomain, canisterId: string): Promise<void>;
  configure(p: Provision, checkpoint: ProvisionCheckpoint): Promise<void>;
  healthy(p: Provision, domain: GroupDomain, canisterId: string): Promise<boolean>;
  readRegistryRevision(): Promise<bigint>;
  registerGroup(p: Provision, checkpoint: ProvisionCheckpoint): Promise<void>; // router CAS, closed before placement
  enableGroup(p: Provision, checkpoint: ProvisionCheckpoint): Promise<void>;
  save(p: Provision): Promise<void>;
};
export type OperatorApproval = { operator: string; proposalId: string; deploymentId: string; subnetId: string };

export function approveProvision(d: PlacementDecision, a: OperatorApproval, groupId: string, revision: bigint): Provision {
  if (d.kind !== 'provision') throw new Error('Nothing to provision');
  if (!a.operator.trim() || !a.proposalId.trim()) throw new Error('Operator approval required');
  if (a.deploymentId !== d.deploymentId || a.subnetId !== d.subnetId) throw new Error('Approval does not match proposal');
  if (!/^[a-z0-9-]{1,32}$/.test(groupId)) throw new Error('Invalid group id');
  return { id: a.proposalId, groupId, deploymentId: d.deploymentId, subnetId: d.subnetId, phase: 'approved', canisters: {}, expectedRevision: revision };
}

export async function runProvision(start: Provision, a: ProvisionAdapter, options: { stopAfterRegistration?: boolean; stopAt?: 'checked' } = {}): Promise<Provision> {
  let p = start;
  const step = async (n: Provision) => { await a.save(n); p = n; };
  if (p.phase === 'failed' || p.phase === 'enabled') return p;
  // An external mutation may have committed without its acknowledgement. Never
  // repeat it from a phase reset; the operator must reconcile its exact receipt.
  if (p.pending) throw new Error(`Unresolved ${p.pending.kind} intent; reconcile the operator receipt before resuming`);
  let savingFailed = false;
  const checkpoint: ProvisionCheckpoint = async n => {
    try { await step(n); } catch (error) { savingFailed = true; throw error; }
  };
  const complete = () => {
    const ids = PER_GROUP_DOMAINS.map(d => {
      const id = p.canisters[d];
      if (!id?.trim()) throw new Error(`Incomplete group: missing ${d}`);
      if (p.observedSubnets?.[d] && p.observedSubnets[d] !== p.subnetId) throw new Error(`${d} landed on unapproved subnet`);
      return id;
    });
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate group canister');
    if (p.canisters.secret_workload_identity) throw new Error('Global service cannot be provisioned per group');
  };
  try {
    await checkpoint(p); // approval is durable before the first external action
    if (p.phase === 'approved') {
      for (const d of PER_GROUP_DOMAINS) {
        if (p.canisters[d]) continue; // resume: never create twice
        const intent: Provision = { ...p, pending: { kind: 'create', domain: d, operation: a.createOperation?.(p, d) } };
        await checkpoint(intent);
        const c = await a.createCanister(intent, d);
        // Keep even an incorrectly placed canister in the operator inventory.
        await checkpoint({ ...p, pending: undefined, canisters: { ...p.canisters, [d]: c.canisterId }, observedSubnets: { ...p.observedSubnets, [d]: c.subnetId } });
        if (c.subnetId !== p.subnetId) throw new Error(`${d} landed on unapproved subnet ${c.subnetId}`);
      }
      complete();
      await checkpoint({ ...p, phase: 'created' });
    }
    complete();
    if (p.phase === 'created') {
      for (const d of PER_GROUP_DOMAINS) {
        if (p.installedDomains?.includes(d)) continue;
        const id = p.canisters[d];
        if (!id) throw new Error(`Missing ${d}`);
        const intent: Provision = { ...p, pending: { kind: 'install', domain: d } };
        await checkpoint(intent);
        await a.install(intent, d, id);
        await checkpoint({ ...p, pending: undefined, installedDomains: [...(p.installedDomains ?? []), d] });
      }
      await checkpoint({ ...p, phase: 'installed' });
    }
    if (p.phase === 'installed') {
      if (typeof a.configure !== 'function') throw new Error('Complete domain configuration required');
      await a.configure(p, checkpoint);
      await checkpoint({ ...p, phase: 'configured' });
    }
    if (p.phase === 'configured') {
      for (const d of PER_GROUP_DOMAINS) {
        const id = p.canisters[d];
        if (!id || !(await a.healthy(p, d, id))) throw new Error(`${d} failed health check`);
      }
      await checkpoint({ ...p, phase: 'checked' });
    }
    if (p.phase === 'checked' && options.stopAt === 'checked') return p; // closed: never registered
    if (p.phase === 'checked') {
      const revision = p.registration?.placementRevision ?? p.registration?.closedRevision ?? p.expectedRevision;
      if ((await a.readRegistryRevision()) !== revision) throw new Error('Registry changed since approval; re-approve');
      await a.registerGroup(p, checkpoint); await checkpoint({ ...p, phase: 'registered' });
    }
    if (p.phase === 'registered' && !options.stopAfterRegistration) { await a.enableGroup(p, checkpoint); await checkpoint({ ...p, pending: undefined, phase: 'enabled' }); }
    return p;
  } catch (e) {
    if (savingFailed) throw e; // never overwrite a durable unresolved intent after disk failure
    if (e instanceof ProvisionRefusedError && p.phase === 'checked' && !p.pending) {
      await checkpoint({ ...p, error: e.message });
      throw e; // retry the checked record, still subject to registry revision CAS
    }
    // Pre-registration failures stay unregistered; created canisters are kept for operator review.
    if (p.phase === 'registered' || p.registration) throw e; // keep acknowledged closed registration resumable
    await checkpoint({ ...p, phase: 'failed', error: e instanceof Error ? e.message : String(e) });
    return p;
  }
}
