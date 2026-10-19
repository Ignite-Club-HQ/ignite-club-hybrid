import { describe, it, expect, vi } from 'vitest';
import { routerProvisionSteps } from './groupProvisionRouter';
import { PER_GROUP_DOMAINS, runProvision, type Provision, type ProvisionAdapter } from './groupProvisioner';

const P = 'aaaaa-aa'; const id = (n: number) => ['rrkah-fqaaa-aaaaa-aaaaq-cai', 'ryjl3-tyaaa-aaaaa-aaaba-cai', 'r7inp-6aaaa-aaaaa-aaabq-cai', 'rkp4c-7iaaa-aaaaa-aaaca-cai',
  'rno2w-sqaaa-aaaaa-aaacq-cai', 'renrk-eyaaa-aaaaa-aaada-cai', 'rdmx6-jaaaa-aaaaa-aaadq-cai', 'qoctq-giaaa-aaaaa-aaaea-cai', 'qjdve-lqaaa-aaaaa-aaaeq-cai',
  'qhbym-qaaaa-aaaaa-aaafq-cai', 'qsgjb-riaaa-aaaaa-aaaga-cai', 'q4eej-kyaaa-aaaaa-aaaha-cai', 'q3fc5-haaaa-aaaaa-aaahq-cai'][n];
void P;
const prov: Provision = { id: 'p', groupId: 'g2', deploymentId: 'local', subnetId: 'tdb26-jop6k-aogll-7ltgs-eruif-6kk7m-qpktf-gdiqx-mxtrf-vb5e6-eqe', phase: 'checked',
  canisters: Object.fromEntries(PER_GROUP_DOMAINS.map((d, i) => [d, id(i)])), expectedRevision: 5n };
const dep = { targetAlias: 'local', deploymentId: 'local', deploymentRevision: 1n, host: 'https://icp-api.io', networkKind: 'public_mainnet',
  primarySubnet: prov.subnetId, approvedSubnets: [prov.subnetId], additionalSubnetsEnabled: false };
const limits = { maxClubs: 500, heapBudgetBytes: 3n * 1024n ** 3n, minCycles: 1n };

describe('recording a new group in the directory', () => {
  it('registers closed, then placement, then opens; workload identity is the shared canister', async () => {
    const calls: string[] = []; let rev = 5n;
    const router = { version: async () => rev,
      register_group: vi.fn(async (g: { accepting: boolean; domains: { domain: string; canister: { toText(): string } }[] }, r: bigint) => {
        calls.push(`group:${g.accepting}:${r}`); return { Ok: ++rev }; }),
      register_group_placement: vi.fn(async (_p: unknown, r: bigint) => { calls.push(`placement:${r}`); return { Ok: ++rev }; }) };
    const s = routerProvisionSteps(router as never, { secret_workload_identity: id(12) }, dep, limits, async () => {}, true);
    let saved = prov;
    await s.registerGroup(prov, async p => { saved = p; }); await s.enableGroup(saved);
    expect(calls).toEqual(['group:false:5', 'placement:6', 'group:true:7']);
    const g = router.register_group.mock.calls[0][0];
    expect(g.domains.find(d => d.domain === 'secret_workload_identity')?.canister.toText()).toBe(id(12));
  });
  it('a directory refusal stops the step', async () => {
    const router = { version: async () => 5n, register_group: async () => ({ Err: 'Revision conflict' }), register_group_placement: vi.fn() };
    await expect(routerProvisionSteps(router as never, { secret_workload_identity: id(12) }, dep, limits).registerGroup(prov)).rejects.toThrow('Revision conflict');
    expect(router.register_group_placement).not.toHaveBeenCalled();
  });
  it('retries a definite registration refusal through the executor without recreating or reinstalling', async () => {
    let rev = 5n; let refuse = true; let saved = prov;
    const router = { version: async () => rev,
      register_group: vi.fn(async () => refuse ? { Err: 'temporarily refused' } : { Ok: ++rev }),
      register_group_placement: vi.fn(async () => ({ Ok: ++rev })) };
    const adapter: ProvisionAdapter = {
      ...routerProvisionSteps(router as never, { secret_workload_identity: id(12) }, dep, limits, async () => {}, true),
      createCanister: vi.fn(), install: vi.fn(), configure: vi.fn(), healthy: vi.fn(),
      save: async p => { saved = structuredClone(p); },
    };
    await expect(runProvision(saved, adapter)).rejects.toThrow('temporarily refused');
    expect(saved.phase).toBe('checked'); expect(saved.pending).toBeUndefined();
    expect(saved.registration).toBeUndefined(); expect(rev).toBe(5n);
    refuse = false;
    expect((await runProvision(saved, adapter)).phase).toBe('enabled');
    expect(router.register_group).toHaveBeenCalledTimes(3);
    expect(router.register_group_placement).toHaveBeenCalledTimes(1);
    expect(adapter.createCanister).not.toHaveBeenCalled(); expect(adapter.install).not.toHaveBeenCalled();
  });
  it('fences a lost registration reply through the executor rather than treating it as refusal', async () => {
    let saved = prov;
    const router = { version: async () => 5n,
      register_group: vi.fn(async () => { throw new Error('committed reply lost'); }),
      register_group_placement: vi.fn() };
    const adapter: ProvisionAdapter = {
      ...routerProvisionSteps(router, { secret_workload_identity: id(12) }, dep, limits),
      createCanister: vi.fn(), install: vi.fn(), configure: vi.fn(), healthy: vi.fn(),
      save: async p => { saved = structuredClone(p); },
    };
    const result = await runProvision(saved, adapter);
    expect(result.pending?.kind).toBe('register');
    await expect(runProvision({ ...saved, phase: 'checked' }, adapter)).rejects.toThrow('Unresolved register');
    expect(router.register_group).toHaveBeenCalledTimes(1);
    expect(router.register_group_placement).not.toHaveBeenCalled();
  });
  it('keeps production activation disabled even with a wiring callback', async () => {
    const wire = vi.fn(async () => {});
    const router = { version: async () => 5n, register_group: vi.fn(), register_group_placement: vi.fn() };
    await expect(routerProvisionSteps(router, { secret_workload_identity: id(12) }, dep, limits, wire).enableGroup(prov)).rejects.toThrow('revocation verification');
    await expect(routerProvisionSteps(router, { secret_workload_identity: id(12) }, { ...dep, targetAlias: 'mainnet' }, limits, wire, true).enableGroup(prov)).rejects.toThrow('revocation verification');
    expect(wire).not.toHaveBeenCalled(); expect(router.register_group).not.toHaveBeenCalled();
  });
  it('cannot activate a group before complete account authority wiring succeeds', async () => {
    const router = { version: async () => 5n, register_group: vi.fn(), register_group_placement: vi.fn() };
    await expect(routerProvisionSteps(router, { secret_workload_identity: id(12) }, dep, limits, undefined, true).enableGroup(prov)).rejects.toThrow('authority wiring');
    const wire = vi.fn(async () => { throw new Error('Unlink recovery pending'); });
    await expect(routerProvisionSteps(router, { secret_workload_identity: id(12) }, dep, limits, wire, true).enableGroup(prov)).rejects.toThrow('Unlink recovery pending');
    expect(router.register_group).not.toHaveBeenCalled();
  });
  it('rejects foreign deployments, duplicate canisters and unapproved subnets before writes', async () => {
    const router = { version: async () => 5n, register_group: vi.fn(), register_group_placement: vi.fn() };
    const steps = routerProvisionSteps(router, { secret_workload_identity: id(12) }, dep, limits);
    await expect(steps.registerGroup({ ...prov, deploymentId: 'foreign' })).rejects.toThrow('another deployment');
    await expect(steps.registerGroup({ ...prov, subnetId: id(12) })).rejects.toThrow('Unapproved');
    await expect(steps.registerGroup({ ...prov, canisters: { ...prov.canisters, events_domain: prov.canisters.club_domain } })).rejects.toThrow('Duplicate');
    await expect(routerProvisionSteps(router, { secret_workload_identity: id(12) }, { ...dep, host: 'http://icp-api.io' }, limits).registerGroup(prov)).rejects.toThrow('HTTPS');
    expect(router.register_group).not.toHaveBeenCalled();
  });
  it('resumes a refused placement from its closed receipt without registering twice', async () => {
    let rev = 5n; let refuse = true; let saved = prov;
    const router = { version: async () => rev,
      register_group: vi.fn(async () => ({ Ok: ++rev })),
      register_group_placement: vi.fn(async () => refuse ? { Err: 'temporarily refused' } : { Ok: ++rev }) };
    const steps = routerProvisionSteps(router as never, { secret_workload_identity: id(12) }, dep, limits);
    await expect(steps.registerGroup(saved, async p => { saved = p; })).rejects.toThrow('refused');
    expect(saved.pending).toBeUndefined(); expect(saved.registration?.closedRevision).toBe(6n);
    refuse = false; await steps.registerGroup(saved, async p => { saved = p; });
    expect(router.register_group).toHaveBeenCalledTimes(1); expect(saved.registration?.placementRevision).toBe(7n);
  });
  it('does not open a group when wiring changed the approved placement revision', async () => {
    let rev = 7n;
    const router = { version: async () => rev, register_group: vi.fn(), register_group_placement: vi.fn() };
    const steps = routerProvisionSteps(router, { secret_workload_identity: id(12) }, dep, limits, async () => { rev++; }, true);
    await expect(steps.enableGroup({ ...prov, registration: { closedRevision: 6n, placementRevision: 7n } })).rejects.toThrow('changed placement');
    expect(router.register_group).not.toHaveBeenCalled();
  });
});
