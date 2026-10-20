import { describe, it, expect } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { ENGINE_INSTALL_SERVICES, engineInstallBinding, runEngineClosedInstall, type EngineInstallManifest, type EngineInstallJournal, type EngineClosedTransport, type EngineServiceStatus } from './engineClosedInstall';
import { collectEngineAcceptance, ENGINE_ACCEPTANCE_CHECKS, type EngineAcceptanceScope } from './engineAcceptance';
import { planClubPlacement } from './engineClubPlacement';
import { GROUP_DOMAINS } from './groupRouting';
import { SHIPPED_GATES, activationStatus } from './groupActivation';
import { CLOUD_ENGINE_RELEASED } from './enginePreparation';
import type { GroupDeployment, DeploymentBoundTable } from './groupDeployment';
import type { GroupCapacity } from './groupPlacement';

const id = (n: number) => Principal.fromUint8Array(new Uint8Array([n, 1])).toText();
const m: EngineInstallManifest = { deploymentId: 'engine-au', groupId: 'g2', host: 'https://engine.example',
  subnetId: id(80), operator: id(81), proxyCanisterId: id(82), identityAccess: id(83), pushWorker: id(84),
  liveCanisters: [id(85)], moduleHashes: Object.fromEntries(ENGINE_INSTALL_SERVICES.map(d => [d, 'a'.repeat(64)])) as EngineInstallManifest['moduleHashes'] };
function installer() {
  const status = new Map<string, EngineServiceStatus>();
  const mutations: string[] = []; const journals: EngineInstallJournal[] = [];
  let n = 1;
  const t: EngineClosedTransport = {
    async create(a) { mutations.push('create'); const canisterId = id(n++); status.set(canisterId, { subnetId: a.subnetId, controllers: a.controllers,
      running: true, moduleHash: null, cycles: 0n, interfaceVerified: true, memoryBytes: 0, capacityBytes: 100, engineServing: true }); return { canisterId, subnetId: a.subnetId }; },
    async status(canisterId) { const s = status.get(canisterId); if (!s) throw new Error('Unknown canister'); return s; },
    async install(canisterId, _service, env) { mutations.push('install'); expect(env.find(v => v.name === 'PROXY_CANISTER_ID')?.value).toBe(m.proxyCanisterId);
      const s = status.get(canisterId); if (!s) throw new Error('Missing service'); s.moduleHash = 'a'.repeat(64); },
    async verifyGovernor(canisterId, governor) { expect((await t.status(canisterId)).controllers).toEqual([governor]); },
    async call(_id, method) { mutations.push(method); return { Ok: null }; },
  };
  const start: EngineInstallJournal = { binding: engineInstallBinding(m), provision: { id: 'engine-install-1', groupId: m.groupId,
    deploymentId: m.deploymentId, subnetId: m.subnetId, phase: 'approved', canisters: {}, expectedRevision: 1n } };
  const save = async (j: EngineInstallJournal) => { journals.push(structuredClone(j)); };
  const run = (j = start) => runEngineClosedInstall(m, j, t, save, () => `op-${n}`);
  return { status, mutations, journals, t, start, save, run };
}

describe('zero-cycle engine closed installation — offline transport', () => {
  it('installs 12 domains and its dedicated photo store, wires them and stays unregistered', async () => {
    const w = installer(); const done = await w.run();
    expect(done.provision.phase).toBe('checked'); expect(w.status.size).toBe(13);
    expect(done.provision.registration).toBeUndefined(); expect(done.provision.configuration?.completed.length).toBeGreaterThan(20);
    expect(done.provision.dedicatedBlobStore?.canisterId).toBeTruthy();
    expect(w.mutations.filter(v => v === 'create')).toHaveLength(13);
    const before = [...w.mutations]; expect((await w.run(done)).provision.phase).toBe('checked'); expect(w.mutations).toEqual(before);
  });
  it('retains ambiguous create intent and refuses another creation on resume', async () => {
    const w = installer(); let calls = 0;
    w.t.create = async () => { calls++; throw new Error('SYS_UNKNOWN'); };
    const stopped = await w.run(); expect(stopped.provision.pending?.kind).toBe('create'); expect(calls).toBe(1);
    await expect(w.run(stopped)).rejects.toThrow('Unresolved create'); expect(calls).toBe(1);
  });
  it('saves create intent before any external mutation and stops on journal failure', async () => {
    const w = installer();
    await expect(runEngineClosedInstall(m, w.start, w.t, async j => { if (j.provision.pending) throw new Error('disk unavailable'); }, () => 'op')).rejects.toThrow('disk unavailable');
    expect(w.mutations).toEqual([]);
  });
  it.each(['install', 'configure'] as const)('retains ambiguous %s mutations without replay', async phase => {
    const w = installer(); let calls = 0;
    if (phase === 'install') {
      const original = w.t.install;
      w.t.install = async (...args) => { await original(...args); calls++; throw new Error('reply lost'); };
    } else {
      w.t.call = async () => { calls++; throw new Error('reply lost'); };
    }
    const stopped = await w.run(); expect(stopped.provision.pending?.kind).toBe(phase); expect(calls).toBe(1);
    await expect(w.run(stopped)).rejects.toThrow(`Unresolved ${phase}`); expect(calls).toBe(1);
  });
  it('refuses live or shared IDs returned by creation', async () => {
    const w = installer(); w.t.create = async () => ({ canisterId: m.liveCanisters[0], subnetId: m.subnetId });
    const stopped = await w.run(); expect(stopped.provision.phase).toBe('failed'); expect(stopped.provision.error).toContain('live/shared');
  });
  it('does not overwrite foreign modules', async () => {
    const w = installer(); const create = w.t.create;
    w.t.create = async a => { const c = await create(a); const s = w.status.get(c.canisterId); if (s) s.moduleHash = 'b'.repeat(64); return c; };
    const stopped = await w.run(); expect(stopped.provision.error).toContain('foreign module'); expect(w.mutations).not.toContain('install');
  });
  it.each(['cycles', 'subnet', 'controller', 'serving', 'capacity', 'interface'] as const)('rejects invalid %s evidence on checked resumes', async field => {
    const w = installer(); const done = await w.run(); const s = [...w.status.values()][0];
    if (field === 'cycles') s.cycles = 1n;
    if (field === 'subnet') s.subnetId = id(90);
    if (field === 'controller') s.controllers.push(id(90));
    if (field === 'serving') s.engineServing = false;
    if (field === 'capacity') s.memoryBytes = s.capacityBytes;
    if (field === 'interface') s.interfaceVerified = false;
    await expect(w.run(done)).rejects.toThrow();
  });
  it('binds proxy, host and module hashes before any action', async () => {
    const w = installer();
    for (const changed of [{ ...m, proxyCanisterId: id(91) }, { ...m, host: 'https://other.example' }, { ...m, moduleHashes: { ...m.moduleHashes, club_domain: 'b'.repeat(64) } }]) {
      await expect(runEngineClosedInstall(changed, w.start, w.t, w.save, () => 'op')).rejects.toThrow('binding changed');
    }
    expect(w.mutations).toEqual([]);
  });
});

function placement() {
  const deployment: GroupDeployment = { id: 'ic', alias: 'mainnet', networkKind: 'public_mainnet', host: 'https://icp-api.io', revision: 1n,
    enabled: true, additionalSubnetsEnabled: false, primarySubnet: 's1', approvedSubnets: ['s1'] };
  const group = (g: string, offset: number) => ({ id: g, targetAlias: 'mainnet', photoStore: `${g}-photo-cai`, domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canisterId: `service-${offset + i}-cai` })) });
  const a = group('a', 0), b = group('b', 20);
  const table: DeploymentBoundTable = { deployments: new Map([['ic', deployment]]),
    bindings: new Map([a, b].map(g => [g.id, { groupId: g.id, deploymentId: 'ic', deploymentRevision: 1n, domains: g.domains.map(d => ({ ...d, subnetId: 's1' })) }])),
    routing: { groups: new Map([['a', a], ['b', b]]), assignments: new Map([['existing', { clubId: 'existing', groupId: 'a', revision: 2n }]]) } };
  const capacity = (groupId: string, used: number): GroupCapacity => ({ groupId, deploymentId: 'ic', subnetId: 's1', enabled: true, ready: true,
    cyclesHealthy: true, clubs: groupId === 'a' ? 10 : 0, maxDomainBytes: 0, dailyGrowthBytes: 0,
    capacity: { deploymentId: 'ic', observedAtMs: 1000, requiredResources: ['storage'], readings: [{ resource: 'storage', used, testedLimit: 1000, evidence: 'local-measurement' }] } });
  return { clubId: 'new', homeCountry: 'AU', countries: { revision: 3n, countryDeployments: new Map([['AU', 'ic']]) }, table,
    approvedDeployments: new Map([['ic', deployment]]), groups: [capacity('a', 700), capacity('b', 0)],
    policy: { deploymentId: 'ic', primarySubnet: 's1', approvedSubnets: ['s1'], additionalSubnetsEnabled: false, currentGroupId: 'a', nowMs: 1000 } };
}
describe('country/group preparation preserves immutable placement', () => {
  it('keeps existing clubs on their group despite a changed or missing country link', () => {
    const p = placement(); p.countries.countryDeployments.clear();
    expect(planClubPlacement({ ...p, clubId: 'existing' })).toMatchObject({ kind: 'existing', groupId: 'a', revision: 2n });
    p.countries.countryDeployments.set('AU', 'future-engine');
    expect(planClubPlacement({ ...p, clubId: 'existing' })).toMatchObject({ kind: 'existing', deploymentId: 'ic', groupId: 'a' });
  });
  it('refuses stale existing deployment bindings without moving the club', () => {
    const p = placement(); const d = p.table.deployments.get('ic'); if (!d) throw new Error('fixture');
    p.table.deployments.set('ic', { ...d, revision: 2n });
    expect(() => planClubPlacement({ ...p, clubId: 'existing' })).toThrow('mismatched');
    expect(p.table.routing.assignments.get('existing')).toEqual({ clubId: 'existing', groupId: 'a', revision: 2n });
  });
  it('keeps fill-first at 70% and changes only new-club proposals at 80%', () => {
    const p = placement(); expect(planClubPlacement(p)).toMatchObject({ kind: 'new', groupId: 'a', authorityRequired: true });
    const reading = p.groups[0].capacity?.readings[0]; if (reading) reading.used = 800;
    expect(planClubPlacement(p)).toMatchObject({ kind: 'new', groupId: 'b' });
    expect(p.table.routing.assignments.has('new')).toBe(false);
  });
  it('blocks missing country links and cloud engine proposals without mainnet fallback', () => {
    const p = placement(); p.countries.countryDeployments.clear(); expect(planClubPlacement(p).kind).toBe('blocked');
    p.countries.countryDeployments.set('AU', 'engine');
    const d = p.table.deployments.get('ic'); if (!d) throw new Error('fixture missing');
    const engine: GroupDeployment = { ...d, id: 'engine', networkKind: 'cloud_engine' };
    p.table.deployments.set('engine', engine); p.approvedDeployments.set('engine', engine);
    expect(planClubPlacement(p)).toMatchObject({ kind: 'blocked', deploymentId: 'engine' });
  });
  it('rejects partial group inventories and missing photo stores', () => {
    const p = placement(); const a = p.table.routing.groups.get('a'); if (!a) throw new Error('fixture');
    p.table.routing.groups.set('a', { ...a, domains: a.domains.slice(1) }); expect(() => planClubPlacement(p)).toThrow('Incomplete');
    p.table.routing.groups.set('a', { ...a, photoStore: undefined }); expect(() => planClubPlacement(p)).toThrow('photo store');
  });
  it('blocks stale capacity, unapproved subnets and closed groups', () => {
    for (const change of ['stale', 'subnet', 'closed']) {
      const p = placement(); p.groups = p.groups.slice(0, 1);
      if (change === 'stale' && p.groups[0].capacity) p.groups[0].capacity.observedAtMs = -1_000_000;
      if (change === 'subnet') p.groups[0].subnetId = 's2';
      if (change === 'closed') p.groups[0].ready = false;
      expect(planClubPlacement(p).kind).toBe('blocked');
    }
  });
});

describe('engine acceptance harness', () => {
  const scope: EngineAcceptanceScope = { mode: 'offline', binding: 'fixture-binding', registryRevision: 3n,
    canisterIds: Object.fromEntries(ENGINE_INSTALL_SERVICES.map((d, i) => [d, id(i + 1)])) as EngineAcceptanceScope['canisterIds'] };
  const good = async (check: typeof ENGINE_ACCEPTANCE_CHECKS[number]) => ({ check, binding: scope.binding, registryRevision: 3n, observedAtMs: 1000, passed: true, evidence: `fixture-${check}` });
  it('collects all 19 explicit checks but never authorizes activation', async () => {
    const report = await collectEngineAcceptance(scope, 1000, good);
    expect(report.results).toHaveLength(19); expect(report.offlinePassed).toBe(true);
    expect(report.activationAuthorized).toBe(false); expect(report.realEngineVerificationRequired).toBe(true);
    expect(CLOUD_ENGINE_RELEASED).toBe(false); expect(activationStatus(SHIPPED_GATES).active).toBe(false);
  });
  it.each(['binding', 'revision', 'stale', 'future', 'failed', 'missing', 'unreadable'])('rejects %s evidence without dropping other checks', async fault => {
    const report = await collectEngineAcceptance(scope, 1000, async check => {
      const e = await good(check); if (check !== 'vault-staff-readback') return e;
      if (fault === 'binding') e.binding = 'foreign'; if (fault === 'revision') e.registryRevision = 4n;
      if (fault === 'stale') e.observedAtMs = -1_000_000; if (fault === 'future') e.observedAtMs = 1001;
      if (fault === 'failed') e.passed = false; if (fault === 'missing') e.evidence = '';
      if (fault === 'unreadable') throw new Error('outage'); return e;
    });
    expect(report.missing).toEqual(['vault-staff-readback']); expect(report.results).toHaveLength(18); expect(report.offlinePassed).toBe(false);
  });
});