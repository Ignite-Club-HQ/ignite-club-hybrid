/** Manual governor check/open/stop. No deploy, creation, funding, moves or
 * rehearsal configuration. All mutable actions require exact revision CAS. */
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { verifyOwnerOpeningChecks, verifyOwnerReciprocalConfiguration, type OwnerCheckSpec, type ObservedService } from '../src/live/ownerOpeningChecks';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { routerGroupRecord } from '../src/live/groupProvisionRouter';
import type { Provision } from '../src/live/groupProvisioner';

const [action, file, pem, out] = process.argv.slice(2);
if (!['register-closed', 'check', 'open', 'stop'].includes(action) || !file || !pem || !out) throw new Error('Usage: owner-group-opening <register-closed|check|open|stop> <approval.json> <operator.pem> <report.json>');
const spec: OwnerCheckSpec & { identityAccess: string; pushWorker: string } = JSON.parse(readFileSync(file, 'utf8'));
if (!/^https:\/\/icp-api\.io$/.test(spec.host)) throw new Error('Owner opening supports the pinned public-mainnet gateway only');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== spec.governor) throw new Error('Approved governor identity required');
Principal.fromText(spec.owner);
const agent = await HttpAgent.create({ host: spec.host, identity });
const router = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: spec.routerId });
const ok = <T>(r: { Ok: T } | { Err: string }): T => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const save = (v: unknown) => {
  const temp = `${out}.tmp`;
  const fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, out);
  const directory = openSync(dirname(out), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
};
const readConfig = async (id: string, resultVariant = false) => {
  const rows = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const factory = () => IDL.Service({ read_group_opening_configuration: IDL.Func([], [resultVariant ? IDL.Variant({ Ok: rows, Err: IDL.Text }) : rows], []) });
  const actor = Actor.createActor(factory, { agent, canisterId: id }) as unknown as { read_group_opening_configuration(): Promise<[string, string][] | { Ok: [string, string][]; Err?: string }> };
  const reply = await actor.read_group_opening_configuration();
  return Array.isArray(reply) ? reply : ok(reply as { Ok: [string, string][] } | { Err: string });
};
if (action === 'register-closed') {
  if (process.env.CONFIRMATION?.trim() !== 'REGISTER GROUP 2 CLOSED') throw new Error('Exact closed registration confirmation required');
  const full = spec as typeof spec & { provisionFile: string; workloadIdentity: string; deploymentRevision: string; primarySubnet: string; maxClubs: number };
  if (!/^\.\.\/deploy\/groups\/g2\/provision\.json$/.test(full.provisionFile)) throw new Error('Exact committed g2 provision file required');
  const provision = JSON.parse(readFileSync(full.provisionFile, 'utf8'), (_, x) => x?.$bigint ? BigInt(x.$bigint) : x) as Provision;
  if (provision.groupId !== 'g2' || provision.phase !== 'checked' || provision.pending) throw new Error('Complete checked closed g2 provision required');
  const { group, placement } = routerGroupRecord(provision, { secret_workload_identity: full.workloadIdentity }, { targetAlias: spec.targetAlias, deploymentId: spec.deploymentId,
    deploymentRevision: BigInt(full.deploymentRevision), host: spec.host, networkKind: 'public_mainnet', primarySubnet: full.primarySubnet,
    approvedSubnets: [full.primarySubnet], additionalSubnetsEnabled: false }, { maxClubs: full.maxClubs, heapBudgetBytes: BigInt(spec.heapBudgetBytes), minCycles: BigInt(spec.minCycles) }, false);
  if (await router.version() !== BigInt(spec.revision)) throw new Error('Registry revision changed before closed registration');
  save({ action, pending: 'register', group, placement, revision: spec.revision });
  const closed = ok(await router.register_group(group, BigInt(spec.revision)));
  save({ action, closedRevision: closed, pending: 'placement', group, placement });
  const revision = ok(await router.register_group_placement(placement, closed));
  save({ action, closedRevision: closed, placementRevision: revision, group, placement });
  console.log(`Group 2 registered CLOSED at revision ${revision}; no owner opening or general accepting enabled.`);
} else if (action === 'stop') {
  if (process.env.CONFIRMATION?.trim() !== 'STOP GROUP 2 TEST PLACEMENTS') throw new Error('Exact stop confirmation required');
  save({ action, pending: 'stop', expectedRevision: spec.revision });
  const receipt = ok(await router.stop_owner_test_group(spec.targetAlias, BigInt(spec.revision)));
  const readback = ok(await router.read_my_owner_test_opening(spec.targetAlias))[0];
  if (!readback || readback.accepting_new || readback.opened_revision !== receipt.opened_revision) throw new Error('Stop outcome requires reconciliation');
  save({ action, receipt });
  console.log('Stopped new owner-test placements; existing clubs retain their assignments and access.');
} else {
  const registry = await readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page(spec.targetAlias, rev, cursor, limit), BigInt(spec.revision));
  const group = registry.groups.find(g => g.id === 'g2'), placement = registry.placements.find(p => p.group_id === 'g2');
  if (!group || !placement) throw new Error('Register Group 2 CLOSED with its complete placement before checking');
  const mgmtIdl = ({ IDL: I }: { IDL: typeof IDL }) => I.Service({ canister_status: I.Func([I.Record({ canister_id: I.Principal })], [I.Record({
    status: I.Variant({ running: I.Null, stopped: I.Null, stopping: I.Null }), module_hash: I.Opt(I.Vec(I.Nat8)), cycles: I.Nat,
    settings: I.Record({ controllers: I.Vec(I.Principal), environment_variables: I.Vec(I.Record({ name: I.Text, value: I.Text })) }) })], []) });
  const observations: ObservedService[] = [];
  for (const s of spec.services) {
    const id = Principal.fromText(s.canisterId);
    const management = Actor.createActor(mgmtIdl, { agent, canisterId: 'aaaaa-aa', effectiveCanisterId: id }) as unknown as {
      canister_status(a: { canister_id: Principal }): Promise<{ status: Record<string, null>; module_hash: [] | [Uint8Array]; cycles: bigint;
        settings: { controllers: Principal[]; environment_variables: { name: string; value: string }[] } }> };
    const actual = await management.canister_status({ canister_id: id });
    const certified = await CanisterStatus.request({ agent, canisterId: id, paths: ['subnet'] });
    const subnet = certified.get('subnet');
    if (!subnet || typeof subnet !== 'object' || !('subnetId' in subnet)) throw new Error(`Certified subnet unavailable: ${s.name}`);
    const health = Actor.createActor(({ IDL: I }: { IDL: typeof IDL }) => I.Service({ memory_stats: I.Func([], [I.Record({ heap_bytes: I.Nat })], ['query']) }), { agent, canisterId: id }) as unknown as { memory_stats(): Promise<{ heap_bytes: bigint }> };
    observations.push({ ...s, subnetId: String(subnet.subnetId), moduleHash: Buffer.from(actual.module_hash[0] ?? []).toString('hex'),
      controllers: actual.settings.controllers.map(p => p.toText()), environment: actual.settings.environment_variables.filter(e =>
        e.name.endsWith('LOCAL_REHEARSAL') || e.name.startsWith('IGNITE_NEW_CLUB_PLACEMENT_')), running: 'running' in actual.status,
      cycles: actual.cycles, heapBytes: (await health.memory_stats()).heap_bytes,
      configuration: await readConfig(s.canisterId, s.name === 'timer_jobs') });
  }
  verifyOwnerOpeningChecks(spec, observations, group, placement);
  if (BigInt(spec.minCycles) !== group.min_cycles || BigInt(spec.heapBudgetBytes) !== group.heap_budget_bytes) throw new Error('Approved health budgets must match the registered group');
  verifyOwnerReciprocalConfiguration(spec, observations, await readConfig(spec.routerId, true), await readConfig(spec.identityAccess, true));
  for (const club of spec.clubIds) {
    const existing = await router.read_hosted_club_assignment(club, spec.targetAlias, registry.revision);
    if ('Ok' in existing || existing.Err !== 'Missing club assignment') throw new Error('Test club UUID is assigned or cannot be verified fresh');
  }
  if (await router.version() !== registry.revision) throw new Error('Registry changed during checks');
  const evidence = { spec, observations, registryRevision: registry.revision, checkedAt: new Date().toISOString(), authorizesOpening: false };
  const evidence_sha256 = createHash('sha256').update(JSON.stringify(evidence, (_, x) => typeof x === 'bigint' ? String(x) : x)).digest('hex');
  save({ ...evidence, evidence_sha256 });
  if (action === 'open') {
    if (process.env.CONFIRMATION?.trim() !== 'OPEN GROUP 2 OWNER TEST') throw new Error('Exact owner opening confirmation required');
    // Signed explicit approval is separate from the read-only check.
    const firstObservation = observations[0];
    if (!firstObservation) throw new Error('Complete service observations required');
    const lowestCycles = observations.reduce((n, s) => s.cycles < n ? s.cycles : n, firstObservation.cycles);
    const largestHeap = observations.reduce((n, s) => s.heapBytes > n ? s.heapBytes : n, 0n);
    save({ ...evidence, evidence_sha256, pending: 'record-owner-group-health' });
    const healthRevision = ok(await router.record_group_health('g2', largestHeap, lowestCycles, registry.revision));
    const approval = { owner: Principal.fromText(spec.owner), group, placement, club_ids: spec.clubIds, expected_revision: healthRevision, evidence_sha256 };
    const intent = { ...evidence, evidence_sha256, pending: approval };
    save(intent);
    const receipt = ok(await router.open_owner_test_group(approval));
    const readback = ok(await router.read_my_owner_test_opening(spec.targetAlias))[0];
    if (!readback || readback.opened_revision !== receipt.opened_revision || readback.approval.evidence_sha256 !== evidence_sha256) throw new Error('Opening outcome requires reconciliation; do not repeat');
    save({ ...evidence, evidence_sha256, receipt });
    console.log('Owner-only Group 2 opening confirmed; general placement remains closed.');
  } else console.log('Placement checks passed; Group 2 remains closed until a separately confirmed open run.');
}