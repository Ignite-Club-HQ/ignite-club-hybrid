import { describe, it, expect, vi } from 'vitest';
import { routerProvisionSteps } from './groupProvisionRouter';
import { PER_GROUP_DOMAINS, type Provision } from './groupProvisioner';

const P = 'aaaaa-aa'; const id = (n: number) => ['rrkah-fqaaa-aaaaa-aaaaq-cai', 'ryjl3-tyaaa-aaaaa-aaaba-cai', 'r7inp-6aaaa-aaaaa-aaabq-cai', 'rkp4c-7iaaa-aaaaa-aaaca-cai',
  'rno2w-sqaaa-aaaaa-aaacq-cai', 'renrk-eyaaa-aaaaa-aaada-cai', 'rdmx6-jaaaa-aaaaa-aaadq-cai', 'qoctq-giaaa-aaaaa-aaaea-cai', 'qjdve-lqaaa-aaaaa-aaaeq-cai',
  'qhbym-qaaaa-aaaaa-aaafq-cai', 'qsgjb-riaaa-aaaaa-aaaga-cai', 'q4eej-kyaaa-aaaaa-aaaha-cai', 'q3fc5-haaaa-aaaaa-aaahq-cai'][n];
void P;
const prov: Provision = { id: 'p', groupId: 'g2', deploymentId: 'ic', subnetId: 'tdb26-jop6k-aogll-7ltgs-eruif-6kk7m-qpktf-gdiqx-mxtrf-vb5e6-eqe', phase: 'checked',
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
    await s.registerGroup(prov); await s.enableGroup(prov);
    expect(calls).toEqual(['group:false:5', 'placement:6', 'group:true:7']);
    const g = router.register_group.mock.calls[0][0];
    expect(g.domains.find(d => d.domain === 'secret_workload_identity')?.canister.toText()).toBe(id(12));
  });
  it('a directory refusal stops the step', async () => {
    const router = { version: async () => 5n, register_group: async () => ({ Err: 'Revision conflict' }), register_group_placement: vi.fn() };
    await expect(routerProvisionSteps(router as never, { secret_workload_identity: id(12) }, dep, limits).registerGroup(prov)).rejects.toThrow('Revision conflict');
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
});
