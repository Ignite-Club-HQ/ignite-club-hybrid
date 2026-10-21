/** Governor-verified general routing snapshot. Reads the live registry and
 * every registered group's services (management + certified reads), verifies
 * removal wiring, creator bindings and reciprocal configuration, then writes
 * the committed frontend snapshot (frontend/src/live/generated/routingGates.ts)
 * plus a JSON report. Read-only on canisters; writes files only.
 * Usage: tsx scripts/produce-routing-gates.ts <operator.pem> <report.json>
 * Env: ICP_HOST (default https://icp-api.io) */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { verifyRemovalWiring, ADMISSION_DOMAINS, type GroupDescriptor } from '../src/live/groupRemovalWiring';
import { verifyOwnerReciprocalConfiguration, type OwnerCheckSpec, type ObservedService } from '../src/live/ownerOpeningChecks';
import { resolveOpeningWorker } from './opening-worker.mjs';

const GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
const host = process.env.ICP_HOST || 'https://icp-api.io';
if (host !== 'https://icp-api.io') throw new Error('Snapshot supports the pinned public-mainnet gateway only');

const [pem, report] = process.argv.slice(2);
if (!pem || !report) throw new Error('Usage: produce-routing-gates <operator.pem> <report.json>');
const ids = JSON.parse(readFileSync(new URL('../../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
const routerId = ids.shard_router as string, identityAccess = ids.identity_access as string;
if (!routerId || !identityAccess) throw new Error('Shared router/identity mappings missing');
const approval = JSON.parse(readFileSync(new URL('../../deploy/groups/g2/general-opening.json', import.meta.url), 'utf8'));
const pushWorker = resolveOpeningWorker(approval.pushWorker, process.env.PUSH_WORKER_PRINCIPAL);
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GOVERNOR) throw new Error('Existing deployment administrator required');
const agent = await HttpAgent.create({ host, identity });
const router = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: Principal.fromText(routerId) });
const ok = <T>(r: { Ok: T } | { Err: string }): T => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };

const saveFile = (path: string, data: string) => {
  const dir = dirname(resolve(path)); mkdirSync(dir, { recursive: true });
  const temp = `${path}.tmp`, fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
  const handle = openSync(dir, 'r'); try { fsyncSync(handle); } finally { closeSync(handle); }
};
const saveJson = (path: string, data: unknown) => saveFile(path, JSON.stringify(data, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));

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
const mgmtFor = (id: Principal) => Actor.createActor(mgmtIdl, { agent, canisterId: 'aaaaa-aa', effectiveCanisterId: id } as Parameters<typeof Actor.createActor>[1]) as unknown as Mgmt;
const readConfig = async (id: string, resultVariant = false) => {
  const rows = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const factory = () => IDL.Service({ read_group_opening_configuration: IDL.Func([], [resultVariant ? IDL.Variant({ Ok: rows, Err: IDL.Text }) : rows], []) });
  const a = Actor.createActor(factory, { agent, canisterId: Principal.fromText(id) }) as unknown as { read_group_opening_configuration(): Promise<[string, string][] | { Ok: [string, string][]; Err?: string }> };
  const reply = await a.read_group_opening_configuration();
  return Array.isArray(reply) ? reply : ok(reply as { Ok: [string, string][] } | { Err: string });
};

const registry = await readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));
if (registry.groups.length === 0) throw new Error('No registered groups; register a group before producing a routing snapshot');

const problems: string[] = [];
const snapshotGroups: RoutingSnapshotGroup[] = [];
type RoutingSnapshotGroup = { id: string; domains: { domain: string; canisterId: string }[]; photoStore: string | null; moduleHashes: Record<string, string> };

for (const group of registry.groups) {
  const placement = registry.placements.find(p => p.group_id === group.id);
  if (!placement) { problems.push(`${group.id}: no placement`); continue; }
  const services = group.domains.filter(d => d.domain !== 'secret_workload_identity')
    .map(d => ({ name: d.domain, id: d.canister.toText(), subnet: placement.domains.find(p => p.domain === d.domain)?.subnet.toText() }));
  const store = group.photo_store[0]?.toText();
  if (!store) { problems.push(`${group.id}: no photo store`); continue; }
  services.push({ name: 'media_blob_store', id: store, subnet: services.find(s => s.name === 'club_domain')?.subnet });
  const observed: ObservedService[] = [];
  const moduleHashes: Record<string, string> = {};
  for (const s of services) {
    if (!s.subnet) { problems.push(`${group.id}/${s.name}: no subnet in placement`); continue; }
    const cid = Principal.fromText(s.id);
    const status = await mgmtFor(cid).canister_status({ canister_id: cid });
    const certified = await CanisterStatus.request({ agent, canisterId: cid, paths: ['subnet'] });
    const subnet = String((certified.get('subnet') as { subnetId: Principal }).subnetId);
    const health = Actor.createActor(({ IDL: I }: { IDL: typeof IDL }) => I.Service({ memory_stats: I.Func([], [I.Record({ heap_bytes: I.Nat })], ['query']) }), { agent, canisterId: cid }) as unknown as { memory_stats(): Promise<{ heap_bytes: bigint }> };
    const heapBytes = (await health.memory_stats()).heap_bytes;
    const moduleHash = Buffer.from(status.module_hash[0] ?? []).toString('hex');
    moduleHashes[s.name] = moduleHash;
    if (!('running' in status.status)) problems.push(`${group.id}/${s.name}: not running`);
    const controllers = status.settings.controllers.map(p => p.toText());
    if (controllers.length !== 1 || controllers[0] !== GOVERNOR) problems.push(`${group.id}/${s.name}: controller is not the sole governor`);
    if (subnet !== s.subnet) problems.push(`${group.id}/${s.name}: subnet mismatch`);
    if (!/^[a-f0-9]{64}$/.test(moduleHash)) problems.push(`${group.id}/${s.name}: module hash missing`);
    if (status.cycles < group.min_cycles) problems.push(`${group.id}/${s.name}: below min_cycles`);
    if (heapBytes >= group.heap_budget_bytes) problems.push(`${group.id}/${s.name}: heap at budget`);
    observed.push({ name: s.name, canisterId: s.id, subnetId: s.subnet, moduleHash, controllers, running: 'running' in status.status,
      cycles: status.cycles, heapBytes, environment: status.settings.environment_variables,
      configuration: await readConfig(s.id, s.name === 'timer_jobs') });
  }
  // Creator placement binding: mandatory for groups that may receive new clubs.
  if (group.accepting) {
    const club = observed.find(s => s.name === 'club_domain');
    const env = (k: string) => club?.environment.filter(e => e.name === k)[0]?.value;
    if (env('IGNITE_NEW_CLUB_PLACEMENT_ROUTER') !== routerId || env('IGNITE_NEW_CLUB_PLACEMENT_GROUP') !== group.id ||
        env('IGNITE_NEW_CLUB_PLACEMENT_TARGET') !== 'mainnet') problems.push(`${group.id}: accepting without creator placement binding`);
  }
  snapshotGroups.push({ id: group.id, domains: group.domains.map(d => ({ domain: d.domain, canisterId: d.canister.toText() })),
    photoStore: store, moduleHashes });
  // Verify the actual delivery identity, not an arbitrary first queue grant.
  const spec: OwnerCheckSpec & { identityAccess: string; pushWorker: string } = {
    governor: GOVERNOR, routerId, identityAccess, pushWorker, targetAlias: group.target_alias,
    deploymentId: placement.deployment_id, host: placement.host, revision: String(registry.revision),
    services: observed.map(s => ({ name: s.name, canisterId: s.canisterId, subnetId: s.subnetId, moduleHash: s.moduleHash })),
    minCycles: String(group.min_cycles), heapBudgetBytes: String(group.heap_budget_bytes) };
  try { verifyOwnerReciprocalConfiguration(spec, observed, await readConfig(routerId, true), await readConfig(identityAccess, true)); }
  catch (e) { problems.push(`${group.id}: ${e instanceof Error ? e.message : e}`); }
}

const descriptors: GroupDescriptor[] = registry.groups.map(g => ({ id: g.id, targetAlias: g.target_alias,
  photoStore: g.photo_store[0]?.toText(), domains: g.domains.map(d => ({ domain: d.domain, canisterId: d.canister.toText() })) }));
const wiring = await verifyRemovalWiring({ revision: registry.revision, groups: descriptors }, identityAccess,
  async id => (await mgmtFor(Principal.fromText(id)).canister_status({ canister_id: Principal.fromText(id) })).settings.environment_variables, Date.now());
problems.push(...wiring.problems);
if (!wiring.evidence) throw new Error(`Removal wiring incomplete; fix these before routing:\n${problems.join('\n')}`);
if (problems.length) throw new Error(`Routing snapshot verification failed:\n${problems.join('\n')}`);

const generatedAt = new Date().toISOString();
// The wire revision is Nat64 (bigint); the shipped DTO requires lossless decimal text.
// Normalize before hashing so the report and generated source carry identical evidence.
const evidence = { registryRevision: String(registry.revision), groups: snapshotGroups,
  removalWiring: { ...wiring.evidence, revision: String(wiring.evidence.revision) }, generatedAt };
const evidenceSha256 = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
const snapshot = { approved: true as const, targetAlias: 'mainnet', host, routerCanisterId: routerId, ...evidence, evidenceSha256 };
saveJson(report, snapshot);
saveFile(new URL('../src/live/generated/routingGates.ts', import.meta.url).pathname,
`/** GENERATED by frontend/scripts/produce-routing-gates.ts on ${generatedAt}.
 * Governor-verified live reads; re-run that workflow to replace this file. */
import type { RoutingGatesSnapshot } from '../generalActivation';

export const ROUTING_GATES_SNAPSHOT: RoutingGatesSnapshot = ${JSON.stringify(snapshot, null, 2)};
`);
console.log(`Routing snapshot verified for ${snapshotGroups.map(g => g.id).join(', ')} at registry revision ${registry.revision}.`);
console.log('Committed snapshot ships with the next frontend release; publish the frontend canister after this run.');
