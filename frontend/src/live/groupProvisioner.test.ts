import { describe, expect, it, vi } from 'vitest';
import { PER_GROUP_DOMAINS, runProvision, type Provision, type ProvisionAdapter } from './groupProvisioner';

const start = (): Provision => ({ id: 'proposal', groupId: 'new', deploymentId: 'local', subnetId: 's1', phase: 'approved', expectedRevision: 2n, canisters: {} });
const full = (): Provision => ({ ...start(), phase: 'checked', canisters: Object.fromEntries(PER_GROUP_DOMAINS.map(d => [d, `c-${d}`])) });
function world() {
  let saved = start();
  const adapter: ProvisionAdapter = {
    createCanister: vi.fn(async (_p, d) => ({ canisterId: `c-${d}`, subnetId: 's1' })),
    install: vi.fn(async () => {}), configure: vi.fn(async () => {}), healthy: vi.fn(async () => true),
    readRegistryRevision: vi.fn(async () => 2n), registerGroup: vi.fn(async () => {}), enableGroup: vi.fn(async () => {}),
    save: vi.fn(async p => { saved = structuredClone(p); }),
  };
  return { adapter, saved: () => saved };
}
describe('durable new-group provisioning', () => {
  it('persists intent before creation and refuses replay after a lost committed reply', async () => {
    const w = world(); let committed = 0;
    w.adapter.createCanister = vi.fn(async () => {
      expect(w.saved().pending).toEqual({ kind: 'create', domain: 'club_domain' });
      committed++; throw new Error('reply lost after creation');
    });
    const failed = await runProvision(start(), w.adapter);
    expect(failed.pending?.kind).toBe('create');
    await expect(runProvision({ ...failed, phase: 'approved' }, w.adapter)).rejects.toThrow('Unresolved create');
    expect(committed).toBe(1); expect(w.adapter.registerGroup).not.toHaveBeenCalled();
  });
  it('keeps wrong-subnet canisters inventoried and rejects a phase reset without creating another', async () => {
    const w = world();
    w.adapter.createCanister = vi.fn(async () => ({ canisterId: 'wrong-subnet-canister', subnetId: 's2' }));
    const failed = await runProvision(start(), w.adapter);
    expect(failed.canisters.club_domain).toBe('wrong-subnet-canister'); expect(failed.observedSubnets?.club_domain).toBe('s2');
    const again = await runProvision({ ...failed, phase: 'created' }, w.adapter);
    expect(again.error).toContain('unapproved subnet'); expect(w.adapter.createCanister).toHaveBeenCalledTimes(1);
    expect(w.adapter.install).not.toHaveBeenCalled();
  });
  it('rejects incomplete persisted checked records before registration or activation', async () => {
    const w = world(); const p = full(); delete p.canisters.timer_jobs;
    expect((await runProvision(p, w.adapter)).error).toContain('missing timer_jobs');
    expect(w.adapter.registerGroup).not.toHaveBeenCalled(); expect(w.adapter.enableGroup).not.toHaveBeenCalled();
  });
  it('rejects duplicate group canisters', async () => {
    const w = world(); const p = full(); p.canisters.events_domain = p.canisters.club_domain;
    expect((await runProvision(p, w.adapter)).error).toContain('Duplicate');
    expect(w.adapter.registerGroup).not.toHaveBeenCalled();
  });
  it('does not repeat acknowledged installations and stops an uncertain installation', async () => {
    const w = world(); const p = { ...full(), phase: 'created' as const, installedDomains: ['club_domain'] as Provision['installedDomains'] };
    w.adapter.install = vi.fn(async () => { throw new Error('install reply lost'); });
    const failed = await runProvision(p, w.adapter);
    expect(failed.pending).toEqual({ kind: 'install', domain: 'events_domain' });
    expect(w.adapter.install).toHaveBeenCalledTimes(1);
    await expect(runProvision({ ...failed, phase: 'created' }, w.adapter)).rejects.toThrow('Unresolved install');
    expect(w.adapter.install).toHaveBeenCalledTimes(1);
  });
  it('retains durable unresolved intent when saving a create acknowledgement fails', async () => {
    const w = world(); const save = w.adapter.save;
    w.adapter.save = vi.fn(async p => { if (p.canisters.club_domain) throw new Error('disk unavailable'); await save(p); });
    await expect(runProvision(start(), w.adapter)).rejects.toThrow('disk unavailable');
    expect(w.saved().pending?.kind).toBe('create');
    await expect(runProvision(w.saved(), w.adapter)).rejects.toThrow('Unresolved create');
    expect(w.adapter.createCanister).toHaveBeenCalledTimes(1);
  });
  it('health failure never registers or accepts a group', async () => {
    const w = world(); w.adapter.healthy = vi.fn(async () => false);
    const result = await runProvision({ ...full(), phase: 'installed' }, w.adapter);
    expect(result.error).toContain('failed health check'); expect(w.adapter.registerGroup).not.toHaveBeenCalled();
    expect(w.adapter.enableGroup).not.toHaveBeenCalled();
  });
});