/** Mainnet operator entry: configure an already-installed new group CLOSED.
 * Never registers, enables routing or touches account admission.
 * Usage: tsx scripts/configure-group-closed.ts <provision.json> <operator.pem>
 * Env: ICP_HOST (default https://icp-api.io), PUSH_WORKER_PRINCIPAL. */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createOperatorTransport, loadOperatorIdentity } from '../src/live/operatorTransport';
import { configureProvisionGroup, groupConfigurationPlan } from '../src/live/groupProvisionConfiguration';
import { PER_GROUP_DOMAINS, type Provision } from '../src/live/groupProvisioner';
import { DEPLOYED_MAINNET_CANISTER_IDS as LIVE } from '../src/live/generated/deployedCanisterIds';

const [file, pem] = process.argv.slice(2);
if (!file || !pem) throw new Error('Usage: configure-group-closed <provision.json> <operator.pem>');
const encode = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? { $bigint: x.toString() } : x, 2);
const decode = (t: string) => JSON.parse(t, (_k, x) => x && typeof x === 'object' && Object.keys(x).length === 1 && typeof x.$bigint === 'string' ? BigInt(x.$bigint) : x);
const receipt = decode(readFileSync(file, 'utf8'));
let p: Provision = receipt.provision ?? receipt;
if (p.phase !== 'installed' && p.phase !== 'configured') throw new Error(`Refusing phase ${p.phase}: only installed groups are configured`);
if (p.pending && p.pending.kind !== 'configure') throw new Error('Unresolved non-configuration intent; reconcile first');
const live = new Set(Object.values(LIVE));
if (PER_GROUP_DOMAINS.some(d => live.has(p.canisters[d] ?? ''))) throw new Error('Group lists a live legacy canister; refusing');
const pushWorker = process.env.PUSH_WORKER_PRINCIPAL;
if (!pushWorker) throw new Error('PUSH_WORKER_PRINCIPAL required');
const mediaBlobStore = p.dedicatedBlobStore?.installed ? p.dedicatedBlobStore.canisterId : undefined;
if (!mediaBlobStore || live.has(mediaBlobStore)) throw new Error('Group needs its own installed photo store; never configure against the live shared store');
const globals = { identityAccess: LIVE.identity_access, mediaBlobStore, pushWorker };
groupConfigurationPlan(p, globals); // validate before any call

const identity = loadOperatorIdentity(pem);
const contracts = (n: string) => import(`../src/lab/bindings/${n}/declarations/${n}.did.js`);
const idls = new Map<string, any>();
for (const d of PER_GROUP_DOMAINS) idls.set(p.canisters[d]!, (await contracts(d)).idlFactory);
idls.set(globals.mediaBlobStore, (await contracts('media_blob_store')).idlFactory);
const transport = await createOperatorTransport({ host: process.env.ICP_HOST || 'https://icp-api.io', identity, idls });
const save = async (next: Provision) => {
  p = structuredClone(next);
  writeFileSync(`${file}.tmp`, encode(receipt.provision ? { ...receipt, provision: p } : p)); renameSync(`${file}.tmp`, file);
};
await configureProvisionGroup(p, save, transport, identity.getPrincipal().toText(), globals);
for (const d of PER_GROUP_DOMAINS) {
  const cycles = await transport.call(p.canisters[d]!, 'cycles_balance', []);
  console.log(`${d}: ${p.canisters[d]} cycles=${String(cycles)}`);
}
console.log(`Configured ${p.configuration?.completed.length} settings; group stays CLOSED (phase ${p.phase}, not registered).`);
