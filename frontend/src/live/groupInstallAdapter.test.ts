import { describe, it, expect } from 'vitest';
import { closedInstallAdapter, ensureDedicatedBlobStore, resumeInterruptedInstall, requiredCycles, type IcpInstallCalls } from './groupInstallAdapter';
import { PER_GROUP_DOMAINS, runProvision, type Provision, type ProvisionAdapter } from './groupProvisioner';

const OP = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
const SUBNET = 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
const start = (): Provision => ({ id: 'capacity:mainnet:g1', groupId: 'g2', deploymentId: 'mainnet', subnetId: SUBNET, phase: 'approved', canisters: {}, expectedRevision: 0n });

function world(opts: { loseCreateReplyAt?: number; loseInstallReplyAt?: number; subnet?: string } = {}) {
  let now = 1_000n, n = 0, creates = 0, installs = 0;
  const ledger = new Map<string, string>(); // createdAt -> canister
  const modules = new Map<string, string>();
  const calls: IcpInstallCalls = {
    cyclesBalance: async () => 100n * 10n ** 12n,
    createCanister: async a => {
      const key = a.createdAtNs.toString();
      if (ledger.has(key)) return { duplicateOf: ledger.get(key)! };
      const id = `new-${++n}`; ledger.set(key, id); creates++;
      if (creates === opts.loseCreateReplyAt) throw new Error('reply lost');
      return { canisterId: id };
    },
    subnetOf: async () => opts.subnet ?? SUBNET,
    status: async id => ({ controllers: [OP], moduleHash: modules.get(id) ?? null, running: true }),
    setEnvironment: async () => {},
    installChunked: async id => { modules.set(id, 'hash'); installs++; if (installs === opts.loseInstallReplyAt) throw new Error('reply lost'); },
    sha256Hex: async () => 'hash',
    cyclesOf: async () => 10n ** 12n,
  };
  const install = closedInstallAdapter(calls, { wasm: () => new Uint8Array([0]), initArg: () => new Uint8Array(), environment: () => [] },
    { operator: OP, liveCanisters: new Set(['live-club']), cyclesPerCanister: 10n ** 12n, nowNs: () => (now += 1n) });
  let saved: Provision = start();
  const registered: string[] = [];
  const adapter: ProvisionAdapter = { ...install,
    configure: async () => {}, readRegistryRevision: async () => 0n,
    registerGroup: async () => { registered.push('register'); }, enableGroup: async () => { registered.push('enable'); },
    save: async p => { saved = structuredClone(p); } };
  return { adapter, calls, get saved() { return saved; }, registered, counts: () => ({ creates, installs }) };
}

describe('closed new-group installer', () => {
  it('installs all 12 services on the approved subnet and stops before registration', async () => {
    const w = world();
    const p = await runProvision(start(), w.adapter, { stopAt: 'checked' });
    expect(p.phase).toBe('checked');
    expect(PER_GROUP_DOMAINS).toHaveLength(12);
    expect(new Set(PER_GROUP_DOMAINS.map(d => p.canisters[d])).size).toBe(12);
    expect(w.registered).toEqual([]);
    expect(w.counts()).toEqual({ creates: 12, installs: 12 });
  });

  it('a lost create reply resumes to the same canister, never a second one', async () => {
    const w = world({ loseCreateReplyAt: 3 });
    const failed = await runProvision(start(), w.adapter, { stopAt: 'checked' });
    expect(failed.phase).toBe('failed');
    expect(failed.pending?.kind).toBe('create');
    const resumed = await resumeInterruptedInstall(w.saved, w.adapter, async p => { await w.adapter.save(p); });
    const done = await runProvision(resumed, w.adapter, { stopAt: 'checked' });
    expect(done.phase).toBe('checked');
    expect(w.counts().creates).toBe(12);
  });

  it('a lost install reply is recognised by module hash and not reinstalled', async () => {
    const w = world({ loseInstallReplyAt: 5 });
    await runProvision(start(), w.adapter, { stopAt: 'checked' });
    const resumed = await resumeInterruptedInstall(w.saved, w.adapter, async p => { await w.adapter.save(p); });
    const done = await runProvision(resumed, w.adapter, { stopAt: 'checked' });
    expect(done.phase).toBe('checked');
    expect(w.counts().installs).toBe(12);
  });

  it('a canister on the wrong subnet fails closed and is not resumable', async () => {
    const w = world({ subnet: 'other-subnet' });
    const p = await runProvision(start(), w.adapter, { stopAt: 'checked' });
    expect(p.phase).toBe('failed');
    expect(p.pending).toBeUndefined();
    expect((await resumeInterruptedInstall(p, w.adapter, async () => {})).phase).toBe('failed');
  });

  it('refuses to overwrite a canister holding a different module', async () => {
    const w = world();
    w.calls.status = async () => ({ controllers: [OP], moduleHash: 'other', running: true });
    const p = await runProvision({ ...start(), phase: 'created', canisters: Object.fromEntries(PER_GROUP_DOMAINS.map((d, i) => [d, `c${i}`])) }, w.adapter, { stopAt: 'checked' });
    expect(p.phase).toBe('failed');
    expect(p.error).toMatch(/different module/);
  });

  it('refuses live group-1 canisters', async () => {
    const w = world();
    await expect(w.adapter.install(start(), 'club_domain', 'live-club')).rejects.toThrow(/live canister/);
  });

  it('budgets cycles only for services still to create', () => {
    expect(requiredCycles(start(), 10n ** 12n)).toBe(12n * 1_100_000_000_000n);
    expect(requiredCycles({ ...start(), canisters: { club_domain: 'x' } }, 10n ** 12n)).toBe(11n * 1_100_000_000_000n);
  });

  it('gives the group its own photo store, created once even after a lost reply', async () => {
    const w = world({ loseCreateReplyAt: 1 });
    await expect(ensureDedicatedBlobStore(start(), w.adapter, w.adapter.save)).rejects.toThrow(/reply lost/);
    const p = await ensureDedicatedBlobStore(w.saved, w.adapter, w.adapter.save);
    expect(p.dedicatedBlobStore).toMatchObject({ canisterId: 'new-1', installed: true });
    expect(w.counts()).toEqual({ creates: 1, installs: 1 });
  });
});
