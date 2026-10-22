/** Mainnet operator entry: create, install and configure a new group, kept CLOSED.
 * Never registers it in the router, opens it or moves clubs.
 * Usage: tsx scripts/install-group-closed.ts <groupId> <operator.pem>
 * Env: REQUEST_ID (from deploy/groups/capacity-requests.json, or "manual"),
 *      APPROVED_BY (GitHub actor), WASM_DIR (dir with <domain>.wasm[.gz]),
 *      PUSH_WORKER_PRINCIPAL, CYCLES_PER_CANISTER_T (default 1.5), ICP_HOST. */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createOperatorTransport, loadOperatorIdentity } from '../src/live/operatorTransport';
import { configureProvisionGroup } from '../src/live/groupProvisionConfiguration';
import { approveProvision, PER_GROUP_DOMAINS, runProvision, type Provision, type ProvisionAdapter } from '../src/live/groupProvisioner';
import { closedInstallAdapter, ensureDedicatedBlobStore, requiredCycles, resumeInterruptedInstall } from '../src/live/groupInstallAdapter';
import { mainnetInstallCalls } from '../src/live/icpInstallCalls';
import { DEPLOYED_MAINNET_CANISTER_IDS as LIVE } from '../src/live/generated/deployedCanisterIds';
import type { GroupDomain } from '../src/live/groupRouting';

const [groupId, pem] = process.argv.slice(2);
if (!groupId || !pem) throw new Error('Usage: install-group-closed <groupId> <operator.pem>');
if (groupId === 'g1') throw new Error('g1 is the live group');
const root = join(import.meta.dirname, '../..');
const limits = JSON.parse(readFileSync(join(root, 'deploy/groups/tested-limits.json'), 'utf8'));
const pushWorker = process.env.PUSH_WORKER_PRINCIPAL;
if (!pushWorker) throw new Error('PUSH_WORKER_PRINCIPAL required');
const wasmDir = process.env.WASM_DIR;
if (!wasmDir) throw new Error('WASM_DIR required');
const perCanister = BigInt(Math.round(Number(process.env.CYCLES_PER_CANISTER_T || '1.5') * 1e12));

const dir = join(root, 'deploy/groups', groupId); mkdirSync(dir, { recursive: true });
const file = join(dir, 'provision.json');
const encode = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? { $bigint: x.toString() } : x, 2) + '\n';
const decode = (t: string) => JSON.parse(t, (_k, x) => x && typeof x === 'object' && Object.keys(x).length === 1 && typeof x.$bigint === 'string' ? BigInt(x.$bigint) : x);
const save = async (p: Provision) => { writeFileSync(`${file}.tmp`, encode(p)); renameSync(`${file}.tmp`, file); };

const identity = loadOperatorIdentity(pem);
const operator = identity.getPrincipal().toText();
let p: Provision;
if (existsSync(file)) {
  p = decode(readFileSync(file, 'utf8'));
  if (p.groupId !== groupId || p.deploymentId !== limits.deploymentId || p.subnetId !== limits.subnetId) throw new Error('Saved record belongs to another group/deployment/subnet');
} else {
  const requestId = process.env.REQUEST_ID || 'manual';
  if (requestId !== 'manual') {
    const queued = JSON.parse(readFileSync(join(root, 'deploy/groups/capacity-requests.json'), 'utf8'));
    const list = Array.isArray(queued) ? queued : queued.requests ?? [];
    if (!list.some((r: { id: string; status: string }) => r.id === requestId && r.status === 'requested-closed')) throw new Error(`No closed request ${requestId}`);
  }
  p = approveProvision({ kind: 'provision', deploymentId: limits.deploymentId, subnetId: limits.subnetId, reason: 'closed install' },
    { operator: process.env.APPROVED_BY || operator, proposalId: `${requestId}:${groupId}`, deploymentId: limits.deploymentId, subnetId: limits.subnetId }, groupId, 0n);
  await save(p);
}
if (p.phase === 'failed' && !p.pending) throw new Error(`Group record failed: ${p.error}. Review its canisters by hand before retrying.`);
if (['registered', 'enabled'].includes(p.phase)) throw new Error('Group already registered; this tool never touches registered groups');

const wasmFor = (d: GroupDomain) => {
  for (const n of [`${d}.wasm.gz`, `${d}.wasm`]) if (existsSync(join(wasmDir, n))) return new Uint8Array(readFileSync(join(wasmDir, n)));
  throw new Error(`Missing build for ${d} in ${wasmDir}`);
};
const wasms = new Map([...PER_GROUP_DOMAINS, 'media_blob_store' as GroupDomain].map(d => [d, wasmFor(d)])); // all builds present before any spend
const governorArg = IDL.encode([IDL.Principal], [Principal.fromText(operator)]);
const live = new Set<string>(Object.values(LIVE));
const host = process.env.ICP_HOST || 'https://icp-api.io';
const calls = await mainnetInstallCalls(host, identity);

const need = requiredCycles(p, perCanister) + (p.dedicatedBlobStore?.canisterId ? 0n : perCanister + 100_000_000_000n);
const have = await calls.cyclesBalance();
console.log(`Operator ${operator}: cycles ${Number(have) / 1e12}T, needs ${Number(need) / 1e12}T for remaining services`);
if (have < need) throw new Error('Not enough cycles: run "Top up canister cycles" / mint cycles for the deploy identity first');

const install = closedInstallAdapter(calls, {
  wasm: d => wasms.get(d)!,
  initArg: d => d === 'timer_jobs' ? IDL.encode([], []) : governorArg, // timer_jobs captures its installer as governor
  environment: d => d === 'pii_access_control' ? [{ name: 'VETKD_KEY_NAME', value: 'key_1' }]
    : (d as string) === 'media_blob_store' ? [{ name: 'GOVERNOR_PRINCIPAL', value: operator }, { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' }] : [],
}, { operator, liveCanisters: live, cyclesPerCanister: perCanister, nowNs: () => BigInt(Date.now()) * 1_000_000n });

const never = async () => { throw new Error('Closed installer never registers or opens a group'); };
const adapter: ProvisionAdapter = { ...install, save,
  configure: async (rec, checkpoint) => {
    const contracts = (n: string) => import(`../src/lab/bindings/${n}/declarations/${n}.did.js`);
    const idls = new Map<string, any>();
    for (const d of PER_GROUP_DOMAINS) idls.set(rec.canisters[d]!, (await contracts(d)).idlFactory);
    idls.set(globals.mediaBlobStore, (await contracts('media_blob_store')).idlFactory);
    const transport = await createOperatorTransport({ host, identity, idls });
    await configureProvisionGroup(rec, checkpoint, transport, operator, globals);
  },
  readRegistryRevision: never, registerGroup: never, enableGroup: never };

p = await resumeInterruptedInstall(p, install, save);
p = await ensureDedicatedBlobStore(p, install, save);
const mediaBlobStore = p.dedicatedBlobStore!.canisterId!;
if (live.has(mediaBlobStore)) throw new Error('Refusing to configure a group against the live shared photo store');
const globals = { identityAccess: LIVE.identity_access, mediaBlobStore, pushWorker };
p = await runProvision(p, adapter, { stopAt: 'checked' });
for (const d of PER_GROUP_DOMAINS) console.log(`${d.padEnd(22)} ${p.canisters[d] ?? '-'}`);
console.log(`${'photo store (own)'.padEnd(22)} ${mediaBlobStore}`);
if (p.phase !== 'checked') throw new Error(`Stopped at ${p.phase}: ${p.error ?? p.pending?.kind ?? ''}. Re-run to resume.`);
// New groups start with the larger stable-backed photo store (empty store, so no copy-over needed).
{
  const { Actor, HttpAgent } = await import('@icp-sdk/core/agent');
  const blobIdl = (await import('../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js')).idlFactory;
  const store: any = Actor.createActor(blobIdl as any, { agent: await HttpAgent.create({ identity, host, shouldFetchRootKey: false }), canisterId: mediaBlobStore });
  const st = await store.stable_storage_status();
  if (!st.enabled) { const r = await store.enable_stable_media_storage(); if ('Err' in r) throw new Error(`Larger photo storage: ${r.Err}`); }
  const { NEW_GROUP_PHOTO_STORE_GIB, capacityBytesFor } = await import('../../scripts/enlarge-photo-store-policy.mjs');
  // Always full size at setup so a group never needs a later enlargement.
  const size = capacityBytesFor(NEW_GROUP_PHOTO_STORE_GIB);
  const r = await store.set_capacity_limit(size); if ('Err' in r) throw new Error(`Photo store size: ${r.Err}`);
  const applied = (await store.get_usage()).capacity_limit_bytes; console.log(`Photo store size ${applied} bytes (larger mode)`);
  if (applied < size) throw new Error(`Photo store size did not reach ${NEW_GROUP_PHOTO_STORE_GIB} GB; the store build lacks the larger-storage setting`);
}
console.log(`Group ${groupId} installed, configured and healthy. It stays CLOSED: not registered, receives no clubs.`);
