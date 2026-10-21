/** Manual governor control for opening Group 2 to everyone.
 * register-closed registers the provisioned inventory; prepare-hashes records
 * the live module fingerprints into the committed approval; check verifies the
 * full opening case without mutating; open flips general admission on with a
 * revision CAS and fresh health; close flips it back off. Existing clubs keep
 * their assignments and access either way. No deploy, install or funding.
 * Usage: tsx scripts/open-group-general.ts <action> <approval.json> <operator.pem> <report.json>
 * Env: CONFIRMATION (REGISTER GROUP 2 CLOSED / OPEN GROUP 2 TO EVERYONE / CLOSE GROUP 2 TO NEW CLUBS) */
import { mkdirSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { verifyOwnerOpeningChecks, verifyOwnerReciprocalConfiguration, type OwnerCheckSpec, type ObservedService } from '../src/live/ownerOpeningChecks';
import { verifyRemovalWiring, type GroupDescriptor } from '../src/live/groupRemovalWiring';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { routerGroupRecord } from '../src/live/groupProvisionRouter';
import type { Provision } from '../src/live/groupProvisioner';
import { resolveOpeningWorker } from './opening-worker.mjs';

const GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
const CONFIRMATIONS: Record<string, string> = {
  'register-closed': 'REGISTER GROUP 2 CLOSED',
  open: 'OPEN GROUP 2 TO EVERYONE',
  close: 'CLOSE GROUP 2 TO NEW CLUBS',
};

const [action, file, pem, out] = process.argv.slice(2);
if (!['register-closed', 'prepare-hashes', 'check', 'open', 'close'].includes(action) || !file || !pem || !out) {
  throw new Error('Usage: open-group-general <register-closed|prepare-hashes|check|open|close> <approval.json> <operator.pem> <report.json>');
}
if (action in CONFIRMATIONS && process.env.CONFIRMATION?.trim() !== CONFIRMATIONS[action]) {
  throw new Error(`Exact confirmation required: ${CONFIRMATIONS[action]}`);
}
const spec: OwnerCheckSpec & { identityAccess: string; pushWorker: string; provisionFile?: string; workloadIdentity?: string;
  deploymentRevision?: string; primarySubnet?: string; maxClubs?: number } = JSON.parse(readFileSync(file, 'utf8'));
if (action !== 'register-closed') spec.pushWorker = resolveOpeningWorker(spec.pushWorker, process.env.PUSH_WORKER_PRINCIPAL);
if (spec.host !== 'https://icp-api.io') throw new Error('General opening supports the pinned public-mainnet gateway only');
if (spec.targetAlias !== 'mainnet' || spec.deploymentId !== 'mainnet') throw new Error('Exact mainnet deployment required');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== spec.governor || spec.governor !== GOVERNOR) throw new Error('Existing deployment administrator required');
const agent = await HttpAgent.create({ host: spec.host, identity });
const router = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: Principal.fromText(spec.routerId) });
const ok = <T>(r: { Ok: T } | { Err: string }): T => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const save = (v: unknown) => {
  mkdirSync(dirname(out), { recursive: true });
  const temp = `${out}.tmp`, fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, out);
  const directory = openSync(dirname(out), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
};

const readRegistry = () => readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page(spec.targetAlias, rev, cursor, limit));
const readConfig = async (id: string, resultVariant = false) => {
  const rows = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const factory = () => IDL.Service({ read_group_opening_configuration: IDL.Func([], [resultVariant ? IDL.Variant({ Ok: rows, Err: IDL.Text }) : rows], []) });
  const a = Actor.createActor(factory, { agent, canisterId: Principal.fromText(id) }) as unknown as { read_group_opening_configuration(): Promise<[string, string][] | { Ok: [string, string][]; Err?: string }> };
  const reply = await a.read_group_opening_configuration();
  return Array.isArray(reply) ? reply : ok(reply as { Ok: [string, string][] } | { Err: string });
};
const mgmtIdl = ({ IDL: I }: { IDL: typeof IDL }) => I.Service({
  canister_status: I.Func([I.Record({ canister_id: I.Principal })], [I.Record({
    status: I.Variant({ running: I.Null, stopped: I.Null, stopping: I.Null }), module_hash: I.Opt(I.Vec(I.Nat8)), cycles: I.Nat,
    settings: I.Record({ controllers: I.Vec(I.Principal), environment_variables: I.Vec(I.Record({ name: I.Text, value: I.Text })) }) })], []),
});
type Mgmt = {
  canister_status(a: { canister_id: Principal }): Promise<{ status: Record<string, null>; module_hash: [] | [Uint8Array]; cycles: bigint;
    settings: { controllers: Principal[]; environment_variables: { name: string; value: string }[] } }>;
};
/** Management calls must name the target canister as effectiveCanisterId, else the boundary returns canister_not_found. */
const mgmtFor = (id: string | Principal) => Actor.createActor(mgmtIdl, { agent, canisterId: 'aaaaa-aa',
  effectiveCanisterId: typeof id === 'string' ? Principal.fromText(id) : id } as Parameters<typeof Actor.createActor>[1]) as unknown as Mgmt;
const envOf = async (id: string) => (await mgmtFor(id).canister_status({ canister_id: Principal.fromText(id) })).settings.environment_variables;

/** Account deletions pin the exact router revision; re-pin forward after open/close bumps it. */
const repinDeletionRegistry = async (revision: bigint) => {
  const unit = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
  const a = Actor.createActor(() => IDL.Service({ pin_owner_test_deletion_registry: IDL.Func([IDL.Record({ registry: IDL.Principal, registry_revision: IDL.Nat64,
    target_alias: IDL.Text, deployment_id: IDL.Text, deployment_revision: IDL.Nat64, host: IDL.Text, network_kind: IDL.Text })], [unit], []) }),
    { agent, canisterId: Principal.fromText(spec.identityAccess) }) as unknown as { pin_owner_test_deletion_registry(b: unknown): Promise<{ Ok: null } | { Err: string }> };
  try {
    const r = await a.pin_owner_test_deletion_registry({ registry: Principal.fromText(spec.routerId), registry_revision: revision, target_alias: spec.targetAlias,
      deployment_id: spec.deploymentId, deployment_revision: BigInt(spec.deploymentRevision ?? '1'), host: spec.host, network_kind: 'public_mainnet' });
    console.log('Err' in r ? `Account deletion re-pin refused (${r.Err}); rerun settings later.` : `Account deletion pinned at revision ${revision}.`);
  } catch (e) { console.log(`Account deletion re-pin failed (${e instanceof Error ? e.message : e}); rerun settings later.`); }
};
async function observeServices(group: { domains: { domain: string; canister: { toText(): string } }[]; photo_store: [] | [{ toText(): string }] },
  placement: { domains: { domain: string; subnet: { toText(): string } }[] }) {
  const services = group.domains.filter(d => d.domain !== 'secret_workload_identity')
    .map(d => ({ name: d.domain, id: d.canister.toText(), subnet: placement.domains.find(p => p.domain === d.domain)?.subnet.toText() }));
  const store = group.photo_store[0]?.toText();
  if (!store || services.some(s => !s.subnet)) throw new Error('Incomplete group inventory or placement');
  services.push({ name: 'media_blob_store', id: store, subnet: services.find(s => s.name === 'club_domain')?.subnet });
  const observed: ObservedService[] = [];
  let lowestCycles: bigint | null = null, largestHeap = 0n;
  for (const s of services) {
    const cid = Principal.fromText(s.id);
    const status = await mgmtFor(cid).canister_status({ canister_id: cid });
    const certified = await CanisterStatus.request({ agent, canisterId: cid, paths: ['subnet'] });
    const subnet = String((certified.get('subnet') as { subnetId: Principal }).subnetId);
    const health = Actor.createActor(({ IDL: I }: { IDL: typeof IDL }) => I.Service({ memory_stats: I.Func([], [I.Record({ heap_bytes: I.Nat })], ['query']) }), { agent, canisterId: cid }) as unknown as { memory_stats(): Promise<{ heap_bytes: bigint }> };
    const heapBytes = (await health.memory_stats()).heap_bytes;
    lowestCycles = lowestCycles === null || status.cycles < lowestCycles ? status.cycles : lowestCycles;
    largestHeap = heapBytes > largestHeap ? heapBytes : largestHeap;
    observed.push({ name: s.name, canisterId: s.id, subnetId: subnet, moduleHash: Buffer.from(status.module_hash[0] ?? []).toString('hex'),
      controllers: status.settings.controllers.map(p => p.toText()), running: 'running' in status.status,
      cycles: status.cycles, heapBytes, environment: status.settings.environment_variables,
      configuration: await readConfig(s.id, s.name === 'timer_jobs') });
  }
  return { observed, lowestCycles: lowestCycles!, largestHeap };
}

/** Removal wiring must hold for EVERY registered group before general routing. */
async function verifyWiring(registry: Awaited<ReturnType<typeof readRegistry>>) {
  const descriptors: GroupDescriptor[] = registry.groups.map(g => ({ id: g.id, targetAlias: g.target_alias,
    photoStore: g.photo_store[0]?.toText(), domains: g.domains.map(d => ({ domain: d.domain, canisterId: d.canister.toText() })) }));
  const wiring = await verifyRemovalWiring({ revision: registry.revision, groups: descriptors }, spec.identityAccess, envOf, Date.now());
  if (!wiring.evidence) throw new Error(`Removal wiring incomplete; fix before opening:\n${wiring.problems.join('\n')}`);
  return wiring.evidence;
}

if (action === 'register-closed') {
  if (!spec.provisionFile || !spec.workloadIdentity || spec.deploymentRevision === undefined || !spec.primarySubnet || !spec.maxClubs) {
    throw new Error('register-closed needs provisionFile, workloadIdentity, deploymentRevision, primarySubnet and maxClubs in the approval');
  }
  const provision = JSON.parse(readFileSync(resolve(spec.provisionFile), 'utf8'), (_, x) => x?.$bigint ? BigInt(x.$bigint) : x) as Provision;
  if (provision.groupId !== 'g2' || !['checked', 'configured'].includes(provision.phase) || provision.pending) throw new Error('Complete configured g2 provision required');
  if (!provision.dedicatedBlobStore?.installed) throw new Error('Group 2 needs its own installed photo store');
  // Mirror shard_router groups::validate so a bad approval stops before any router call.
  if (!(BigInt(spec.heapBudgetBytes) > 0n && BigInt(spec.heapBudgetBytes) <= 3n * 1024n ** 3n) || !(BigInt(spec.minCycles) > 0n)
    || !(spec.maxClubs > 0 && spec.maxClubs <= 100_000)) {
    throw new Error('Approval budgets outside router limits (heapBudgetBytes 1..3 GiB, minCycles > 0, maxClubs 1..100000)');
  }
  // Mirror shard_router discovery::validate (placement).
  if (!(BigInt(spec.deploymentRevision) >= 1n)) throw new Error('Approval deploymentRevision must be 1 or higher (router placement rule)');
  const { group, placement } = routerGroupRecord(provision, { secret_workload_identity: spec.workloadIdentity },
    { targetAlias: spec.targetAlias, deploymentId: spec.deploymentId, deploymentRevision: BigInt(spec.deploymentRevision), host: spec.host,
      networkKind: 'public_mainnet', primarySubnet: spec.primarySubnet, approvedSubnets: [spec.primarySubnet], additionalSubnetsEnabled: false },
    { maxClubs: spec.maxClubs, heapBudgetBytes: BigInt(spec.heapBudgetBytes), minCycles: BigInt(spec.minCycles) }, false);
  // Resume: an earlier run may have registered the (closed) group but not its placement; the
  // router then refuses whole-registry reads until the placement exists. Only finish that half.
  let registry: Awaited<ReturnType<typeof readRegistry>> | null = null;
  try { registry = await readRegistry(); } catch (e) {
    if (!String((e as Error).message).includes('Incomplete group placement registry')) throw e;
  }
  if (!registry) {
    const revision = await router.version();
    save({ action, pending: 'placement-resume', revision: String(revision), group, placement });
    const placed = ok(await router.register_group_placement(placement, revision));
    save({ action, placementRevision: String(placed), pending: undefined, group, placement });
    console.log(`Group 2 placement completed (resumed) at revision ${placed}; group remains CLOSED.`);
    process.exit(0);
  }
  const existing = registry.groups.find(g => g.id === 'g2');
  if (existing?.accepting) throw new Error('Group 2 is already open; run close first, not register-closed');
  const revision = await router.version();
  save({ action, pending: 'register', revision: String(revision), group, placement });
  const closed = ok(await router.register_group(group, revision));
  save({ action, closedRevision: String(closed), pending: 'placement', group, placement });
  const placed = ok(await router.register_group_placement(placement, closed));
  save({ action, closedRevision: String(closed), placementRevision: String(placed), pending: undefined, group, placement });
  console.log(`Group 2 registered CLOSED at revision ${placed}; run prepare-hashes, then check, then open.`);
} else if (action === 'prepare-hashes') {
  const registry = await readRegistry();
  const group = registry.groups.find(g => g.id === 'g2'), placement = registry.placements.find(p => p.group_id === 'g2');
  if (!group || !placement) throw new Error('Register Group 2 CLOSED before recording hashes');
  const { observed } = await observeServices(group, placement);
  for (const s of observed) {
    if (!s.running || s.controllers.length !== 1 || s.controllers[0] !== GOVERNOR || !/^[a-f0-9]{64}$/.test(s.moduleHash)) {
      throw new Error(`Unusable fingerprint: ${s.name}`);
    }
  }
  spec.services = observed.map(s => ({ name: s.name, canisterId: s.canisterId, subnetId: s.subnetId, moduleHash: s.moduleHash }));
  writeFileSync(file, JSON.stringify(spec, null, 2) + '\n');
  save({ action, services: spec.services, registryRevision: String(registry.revision) });
  console.log(`Recorded 13 live module fingerprints into ${file}; commit this file, then run check.`);
} else {
  const registry = await readRegistry();
  const group = registry.groups.find(g => g.id === 'g2'), placement = registry.placements.find(p => p.group_id === 'g2');
  if (!group || !placement) throw new Error('Group 2 is not registered; run register-closed first');
  if (!spec.services?.length) throw new Error('Approval has no recorded module fingerprints; run prepare-hashes first');
  const { observed, lowestCycles, largestHeap } = await observeServices(group, placement);
  verifyOwnerOpeningChecks(spec, observed, group, placement);
  verifyOwnerReciprocalConfiguration(spec, observed, await readConfig(spec.routerId, true), await readConfig(spec.identityAccess, true));
  const wiring = await verifyWiring(registry);
  if (BigInt(spec.minCycles) !== group.min_cycles || BigInt(spec.heapBudgetBytes) !== group.heap_budget_bytes) {
    throw new Error('Approved health budgets do not match the registered group; re-run prepare-hashes');
  }
  if (action === 'check') {
    save({ action, registryRevision: String(registry.revision), accepting: group.accepting, wiring, observed: observed.map(o => ({ name: o.name, moduleHash: o.moduleHash, cycles: String(o.cycles) })) });
    console.log(`Group 2 is registered and ${group.accepting ? 'OPEN to new clubs' : 'closed'}; all checks passed.`);
  } else if (action === 'open') {
    if (group.accepting) throw new Error('Group 2 is already open');
    const openRecord = { ...group, accepting: true };
    save({ action, pending: 'open', expectedRevision: String(registry.revision), openRecord });
    const newRevision = ok(await router.register_group(openRecord, registry.revision));
    save({ action, pending: 'health', openedRevision: String(newRevision) });
    try { ok(await router.record_group_health('g2', largestHeap, lowestCycles, newRevision)); }
    catch { console.log('Health report refused; the scheduled reporter will refresh it.'); }
    const after = await readRegistry();
    const reopened = after.groups.find(g => g.id === 'g2');
    if (!reopened || !reopened.accepting) throw new Error('Open readback failed; reconcile manually, do not replay the call');
    await repinDeletionRegistry(after.revision);
    save({ action, openedRevision: String(newRevision), accepting: true, wiring });
    console.log(`Group 2 is OPEN to new clubs at revision ${after.revision}. Existing clubs keep their access.`);
  } else {
    if (!group.accepting) throw new Error('Group 2 is already closed to new clubs');
    const closedRecord = { ...group, accepting: false };
    save({ action, pending: 'close', expectedRevision: String(registry.revision), closedRecord });
    const newRevision = ok(await router.register_group(closedRecord, registry.revision));
    const after = await readRegistry();
    const closed = after.groups.find(g => g.id === 'g2');
    if (!closed || closed.accepting) throw new Error('Close readback failed; reconcile manually, do not replay the call');
    await repinDeletionRegistry(after.revision);
    save({ action, closedRevision: String(newRevision), accepting: false });
    console.log('Group 2 is closed to new clubs. Existing clubs keep their assignment and access.');
  }
}
