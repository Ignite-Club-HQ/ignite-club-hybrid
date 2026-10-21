/** Governor-signed scheduled group health reporter.
 * Reads every registered group's public cycles_balance/memory_stats queries
 * anonymously and reports the largest heap and smallest cycle balance to the
 * router so placement can pick groups with real headroom. Reports nothing
 * about unregistered groups; mutates nothing else.
 * Usage: tsx scripts/report-group-health.ts <operator.pem> <report.json>
 * Env: ICP_HOST (default https://icp-api.io). */
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Actor, HttpAgent, AnonymousIdentity } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { idlFactory, type _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { GROUP_DOMAINS } from '../src/live/groupRouting';
import { DEPLOYED_MAINNET_CANISTER_IDS as LIVE } from '../src/live/generated/deployedCanisterIds';

const GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';

const [pem, report] = process.argv.slice(2);
if (!pem || !report) throw new Error('Usage: report-group-health <operator.pem> <report.json>');
const host = process.env.ICP_HOST || 'https://icp-api.io';
const routerId = LIVE.shard_router;
if (!routerId) throw new Error('shard_router canister ID missing from a fresh checkout; restore deploy/mainnet/.icp data first');

const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GOVERNOR) throw new Error('Existing deployment administrator required');
const router = Actor.createActor<_SERVICE>(idlFactory, {
  agent: await HttpAgent.create({ host, identity }),
  canisterId: Principal.fromText(routerId),
});
const ok = <T>(reply: { Ok: T } | { Err: string }): T => { if ('Err' in reply) throw new Error(reply.Err); return reply.Ok; };

const save = (data: unknown) => {
  mkdirSync(dirname(report), { recursive: true });
  const temp = `${report}.tmp`, fd = openSync(temp, 'w', 0o600);
  try { writeSync(fd, JSON.stringify(data, (_, v) => typeof v === 'bigint' ? String(v) : v, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, report);
};

const healthIdl = ({ IDL: I }: { IDL: typeof IDL }) => I.Service({
  cycles_balance: I.Func([], [I.Nat], ['query']),
  memory_stats: I.Func([], [I.Record({ heap_bytes: I.Nat, memory_bytes: I.Nat, stable_bytes: I.Nat })], ['query']),
});
const anonAgent = await HttpAgent.create({ host, identity: new AnonymousIdentity() });
const serviceActor = (id: string) => Actor.createActor(healthIdl, { agent: anonAgent, canisterId: Principal.fromText(id) }) as unknown as {
  cycles_balance(): Promise<bigint>;
  memory_stats(): Promise<{ heap_bytes: bigint; memory_bytes: bigint; stable_bytes: bigint }>;
};

const registry = await readPinnedGroupRegistry((rev, cursor, limit) =>
  router.read_group_registry_page('mainnet', rev, cursor, limit));
const domains: string[] = [...GROUP_DOMAINS, 'media_blob_store'];
const liveIds = new Set(Object.values(LIVE).filter((x): x is string => typeof x === 'string'));

const groups: Array<Record<string, unknown>> = [];
const problems: string[] = [];
for (const group of registry.groups) {
  const services: Array<{ name: string; canister: string; heapBytes: bigint; cycles: bigint }> = [];
  // Shared infrastructure (the workload identity singleton) is registered as a group
  // domain but is not the group's own capacity: skip it so its balance/heap never
  // distorts placement health or trips the legacy-canister refusal.
  const dedicated = group.domains.filter(d => d.domain !== 'secret_workload_identity');
  const photoStore = group.photo_store[0]; // opt principal decodes as [] | [Principal]
  const canisters: string[] = [...dedicated.map(d => d.canister.toText()), photoStore?.toText()]
    .filter((x): x is string => typeof x === 'string');
  for (const canister of canisters) {
    try {
      const [cycles, memory] = await Promise.all([serviceActor(canister).cycles_balance(), serviceActor(canister).memory_stats()]);
      if (typeof cycles !== 'bigint' || typeof memory.heap_bytes !== 'bigint') throw new Error('unreadable health query reply');
      services.push({ name: canister, canister, heapBytes: memory.heap_bytes, cycles });
    } catch (error) {
      problems.push(`${group.id}: ${canister} health read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (services.length !== canisters.length || canisters.length === 0) continue; // never report partial readings
  if (services.some(s => liveIds.has(s.canister))) { problems.push(`${group.id}: lists a live legacy canister; refusing to report health for it`); continue; }
  const largestHeap = services.reduce((a, s) => s.heapBytes > a ? s.heapBytes : a, 0n);
  const lowestCycles = services.reduce((a, s) => s.cycles < a ? s.cycles : a, services[0].cycles);
  const revision = Number(registry.revision);
  let applied: { Ok: bigint } | { Err: string };
  try { applied = await router.record_group_health(group.id, largestHeap, lowestCycles, revision); }
  catch (error) { problems.push(`${group.id}: health report failed: ${error instanceof Error ? error.message : String(error)}`); continue; }
  if ('Err' in applied) { problems.push(`${group.id}: health report rejected: ${applied.Err}`); continue; }
  const evidence = createHash('sha256').update(JSON.stringify({ group: group.id, revision, largestHeap: String(largestHeap), lowestCycles: String(lowestCycles) })).digest('hex');
  groups.push({ id: group.id, revision, largestHeap: String(largestHeap), lowestCycles: String(lowestCycles), services: services.length, evidence });
}

if (registry.groups.length === 0) {
  save({ reportedAt: new Date().toISOString(), host, routerId, revision: String(registry.revision), groups: [], problems: [], note: 'no registered groups yet' });
  console.log(`No registered groups at revision ${registry.revision}; nothing to report yet.`);
  process.exit(0);
}
if (groups.length === 0) throw new Error(`No group health reported:\n${problems.join('\n')}`);
save({ reportedAt: new Date().toISOString(), host, routerId, revision: String(registry.revision), groups, problems });
console.log(`Reported health for ${groups.length} group(s) at revision ${registry.revision}.`);
for (const p of problems) console.error(`problem: ${p}`);
