/** Engine-independent installer protocol. No CLI/network implementation is
 * shipped: a real console-authorized transport must supply verified operations.
 * Unknown creates never replay; runProvision retains the unresolved intent. */
import { Principal } from '@icp-sdk/core/principal';
import { PER_GROUP_DOMAINS, runProvision, type Provision, type ProvisionCheckpoint, type ProvisionAdapter } from './groupProvisioner';
import { configureProvisionGroup, type ConfigurationTransport } from './groupProvisionConfiguration';

export const ENGINE_INSTALL_SERVICES = [...PER_GROUP_DOMAINS, 'media_blob_store'] as const;
export type EngineInstallService = typeof ENGINE_INSTALL_SERVICES[number];
export type EngineInstallManifest = {
  deploymentId: string; groupId: string; host: string; subnetId: string; operator: string;
  proxyCanisterId: string; identityAccess: string; pushWorker: string;
  liveCanisters: readonly string[];
  moduleHashes: Record<EngineInstallService, string>;
};
export type EngineServiceStatus = {
  subnetId: string; controllers: string[]; running: boolean; moduleHash: string | null;
  cycles: bigint; interfaceVerified: boolean; memoryBytes: number; capacityBytes: number;
  engineServing: boolean;
};
export type EngineClosedTransport = ConfigurationTransport & {
  /** No funding amount/ledger. Operation is journaled, but not assumed deduped. */
  create(a: { operation: string; subnetId: string; controllers: string[] }): Promise<{ canisterId: string; subnetId: string }>;
  status(id: string): Promise<EngineServiceStatus>;
  install(id: string, service: EngineInstallService, environment: { name: string; value: string }[]): Promise<void>;
};
export type EngineInstallJournal = { binding: string; provision: Provision };

function principal(id: string) {
  const p = Principal.fromText(id);
  if (p.isAnonymous() || p.toText() === 'aaaaa-aa') throw new Error('Non-anonymous principal required');
  return p.toText();
}
export function engineInstallBinding(m: EngineInstallManifest): string {
  const url = new URL(m.host);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Engine HTTPS origin required');
  if (!m.deploymentId.trim() || !m.groupId.trim()) throw new Error('Deployment and group required');
  [m.subnetId, m.operator, m.proxyCanisterId, m.identityAccess, m.pushWorker, ...m.liveCanisters].forEach(principal);
  if (new Set(m.liveCanisters).size !== m.liveCanisters.length) throw new Error('Duplicate live engine inventory');
  if (new Set([m.proxyCanisterId, m.identityAccess, m.pushWorker]).size !== 3) throw new Error('Distinct shared services required');
  for (const d of ENGINE_INSTALL_SERVICES) if (!/^[a-f0-9]{64}$/.test(m.moduleHashes[d] ?? '')) throw new Error(`Exact module hash required: ${d}`);
  return JSON.stringify([m.deploymentId, m.groupId, url.origin, m.subnetId, m.operator, m.proxyCanisterId,
    m.identityAccess, m.pushWorker, [...m.liveCanisters].sort(), ENGINE_INSTALL_SERVICES.map(d => [d, m.moduleHashes[d]])]);
}

export async function runEngineClosedInstall(m: EngineInstallManifest, start: EngineInstallJournal,
  t: EngineClosedTransport, save: (j: EngineInstallJournal) => Promise<void>, operation: () => string): Promise<EngineInstallJournal> {
  m = structuredClone(m); start = structuredClone(start);
  const binding = engineInstallBinding(m);
  if (start.binding !== binding || start.provision.deploymentId !== m.deploymentId || start.provision.groupId !== m.groupId || start.provision.subnetId !== m.subnetId) throw new Error('Engine install binding changed');
  if (start.provision.registration || ['registered', 'enabled'].includes(start.provision.phase)) throw new Error('Engine installer cannot register or open a group');
  if (start.provision.pending) throw new Error(`Unresolved ${start.provision.pending.kind} intent; exact operator reconciliation required`);
  const reserved = new Set([...m.liveCanisters, m.proxyCanisterId, m.identityAccess, m.pushWorker]);
  const own = (id: string) => { principal(id); if (reserved.has(id)) throw new Error('Refusing live/shared canister'); };
  const verify = async (id: string) => {
    own(id); const s = await t.status(id);
    if (s.subnetId !== m.subnetId || s.controllers.length !== 1 || s.controllers[0] !== m.operator || !s.engineServing || s.cycles !== 0n) throw new Error('Engine controller/subnet/service/zero-cycle evidence invalid');
    if (s.moduleHash !== null && !/^[a-f0-9]{64}$/.test(s.moduleHash)) throw new Error('Malformed engine module hash');
    if (typeof s.running !== 'boolean' || typeof s.interfaceVerified !== 'boolean' || s.engineServing !== true ||
        !Number.isSafeInteger(s.memoryBytes) || s.memoryBytes < 0 || !Number.isSafeInteger(s.capacityBytes) || s.capacityBytes <= s.memoryBytes) throw new Error('Invalid engine capacity/status evidence');
    return s;
  };
  const health = async (id: string, d: EngineInstallService) => {
    const s = await verify(id);
    return s.running && s.moduleHash === m.moduleHashes[d] && s.interfaceVerified &&
      Number.isSafeInteger(s.memoryBytes) && s.memoryBytes >= 0 && Number.isSafeInteger(s.capacityBytes) && s.capacityBytes > s.memoryBytes;
  };
  const install = async (id: string, d: EngineInstallService) => {
    const s = await verify(id);
    if (s.moduleHash === m.moduleHashes[d]) return;
    if (s.moduleHash) throw new Error('Refusing foreign module overwrite');
    await t.install(id, d, [{ name: '__META_PROJECT', value: m.deploymentId }, { name: '__META_NAME', value: d }, { name: 'PROXY_CANISTER_ID', value: m.proxyCanisterId }]);
    if ((await verify(id)).moduleHash !== m.moduleHashes[d]) throw new Error('Installed module readback mismatch');
  };
  const checkpoint: ProvisionCheckpoint = p => save(structuredClone({ binding, provision: p }));
  // Revalidate every saved ID even on checked resumes. Never trust a phase alone.
  const savedIds = [...Object.values(start.provision.canisters), start.provision.dedicatedBlobStore?.canisterId].filter((id): id is string => !!id);
  if (new Set(savedIds).size !== savedIds.length) throw new Error('Duplicate saved engine inventory');
  for (const id of savedIds) await verify(id);
  const create = async (p: Provision) => {
    const token = p.pending?.operation;
    if (!token?.trim()) throw new Error('Durable create operation required');
    const c = await t.create({ operation: token, subnetId: m.subnetId, controllers: [m.operator] });
    own(c.canisterId);
    if (Object.values(p.canisters).includes(c.canisterId)) throw new Error('Duplicate created engine service');
    return c;
  };
  const a: ProvisionAdapter = {
    createOperation: operation, createCanister: p => create(p), install: (_p, d, id) => install(id, d),
    healthy: (_p, d, id) => health(id, d), save: checkpoint,
    async configure(p, cp) {
      let b = p.dedicatedBlobStore;
      if (!b?.canisterId) {
        const token = operation();
        const intent: Provision = { ...p, pending: { kind: 'create', operation: token }, dedicatedBlobStore: { createOperation: token } };
        await cp(intent);
        const c = await create(intent);
        b = { canisterId: c.canisterId, subnetId: c.subnetId, createOperation: token };
        p = { ...p, pending: undefined, dedicatedBlobStore: b }; await cp(p);
      }
      const id = b.canisterId;
      if (!id || b.subnetId !== m.subnetId) throw new Error('Dedicated engine photo store subnet mismatch');
      if (!b.installed) {
        await cp({ ...p, pending: { kind: 'install', operation: 'media_blob_store' } });
        await install(id, 'media_blob_store');
        p = { ...p, pending: undefined, dedicatedBlobStore: { ...b, installed: true } }; await cp(p);
      }
      if (!await health(id, 'media_blob_store')) throw new Error('Engine photo store health failed');
      await configureProvisionGroup(p, cp, t, m.operator, { identityAccess: m.identityAccess, pushWorker: m.pushWorker, mediaBlobStore: id });
    },
    readRegistryRevision: async () => { throw new Error('Registration forbidden'); },
    registerGroup: async () => { throw new Error('Registration forbidden'); },
    enableGroup: async () => { throw new Error('Opening forbidden'); },
  };
  const p = await runProvision(start.provision, a, { stopAt: 'checked' });
  if (p.phase === 'checked') {
    for (const d of PER_GROUP_DOMAINS) {
      const id = p.canisters[d]; if (!id || !await health(id, d)) throw new Error('Checked engine health changed');
    }
    const blob = p.dedicatedBlobStore?.canisterId;
    if (!blob || !await health(blob, 'media_blob_store')) throw new Error('Checked engine photo store missing');
  }
  return { binding, provision: p };
}