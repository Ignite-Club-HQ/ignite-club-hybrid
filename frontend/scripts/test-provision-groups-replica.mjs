// Local management/directory restart evidence only. Per-domain canisters use
// the router WASM as a small install probe, NOT production domain health proof.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { approveProvision, runProvision, PER_GROUP_DOMAINS } from '../src/live/groupProvisioner.ts';
import { routerProvisionSteps } from '../src/live/groupProvisionRouter.ts';

const wasm = process.env.SHARD_ROUTER_WASM ?? resolve(import.meta.dirname, '../../target/wasm32-unknown-unknown/release/shard_router.wasm');
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const arg = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]);
const ok = r => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const fixture = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], arg });
  fixture.actor.setPrincipal(governor); const router = fixture.actor;
  const subnetId = (await pic.getApplicationSubnets())[0].id.toText();
  const globalId = (await pic.createCanister({ sender: governor, controllers: [governor] })).toText();
  const dep = { targetAlias: 'local', deploymentId: 'local', deploymentRevision: 1n, host: 'https://icp-api.io', networkKind: 'public_mainnet', primarySubnet: subnetId, approvedSubnets: [subnetId], additionalSubnetsEnabled: false };
  let rejectPlacement = true; let losePlacementReply = false;
  const wrappedRouter = {
    version: () => router.version(), register_group: (...args) => router.register_group(...args),
    register_group_placement: async (placement, rev) => {
      if (rejectPlacement) return router.register_group_placement(placement, rev + 1n);
      const result = await router.register_group_placement(placement, rev);
      if (losePlacementReply) throw new Error('placement reply lost after commit');
      return result;
    },
  };
  const steps = routerProvisionSteps(wrappedRouter, { secret_workload_identity: globalId }, dep,
    { maxClubs: 500, heapBudgetBytes: 3n * 1024n ** 3n, minCycles: 1n }, async () => {}, true);
  let saved; let creates = 0; let lostCreate; const installed = new Set();
  const adapter = {
    ...steps,
    createCanister: async (_p, domain) => {
      creates++;
      const canisterId = await pic.createCanister({ sender: governor, controllers: [governor], targetSubnetId: Principal.fromText(subnetId) });
      const receipt = { canisterId: canisterId.toText(), subnetId: (await pic.getCanisterSubnetId(canisterId)).toText() };
      if (creates === 1) { lostCreate = { domain, ...receipt }; throw new Error('create reply lost after commit'); }
      return receipt;
    },
    install: async (_p, domain, id) => {
      assert.equal(installed.has(domain), false, 'acknowledged install never repeated');
      await pic.installCode({ canisterId: Principal.fromText(id), wasm, arg, sender: governor }); installed.add(domain);
    },
    configure: async () => {}, // Probes have no domain settings; not full configuration evidence.
    healthy: async (_p, _domain, id) => {
      const actor = pic.createActor(idlFactory, Principal.fromText(id)); actor.setPrincipal(governor);
      return typeof await actor.version() === 'bigint';
    },
    save: async p => { saved = structuredClone(p); },
  };
  const approved = approveProvision({ kind: 'provision', deploymentId: 'local', subnetId, reason: 'full' },
    { operator: governor.toText(), proposalId: 'local-probe', deploymentId: 'local', subnetId }, 'probe', await router.version());
  const failed = await runProvision(approved, adapter);
  assert.equal(failed.pending.kind, 'create');
  await assert.rejects(runProvision({ ...failed, phase: 'approved' }, adapter), /Unresolved create/);
  assert.equal(creates, 1); assert.deepEqual(ok(await router.list_groups()), []);
  // Exact management read-back of the lost ID reconciles the local operator receipt.
  assert.ok(lostCreate); assert.equal((await pic.getCanisterSubnetId(Principal.fromText(lostCreate.canisterId))).toText(), subnetId);
  await assert.rejects(runProvision({ ...failed, phase: 'approved', pending: undefined, canisters: { [lostCreate.domain]: lostCreate.canisterId }, observedSubnets: { [lostCreate.domain]: subnetId } }, adapter), /Revision conflict/);
  let groups = ok(await router.list_groups()); assert.equal(groups.length, 1); assert.equal(groups[0].accepting, false);
  assert.equal(saved.pending, undefined); assert.ok(saved.registration.closedRevision);
  rejectPlacement = false; losePlacementReply = true;
  await assert.rejects(runProvision(saved, adapter), /reply lost after commit/);
  await assert.rejects(runProvision(saved, adapter), /Unresolved placement/);
  assert.equal(ok(await router.list_groups())[0].accepting, false);
  const snapshot = ok(await router.read_group_registry('local'));
  assert.equal(snapshot.placements.length, 1); assert.equal(snapshot.placements[0].group_id, 'probe');
  // Reconcile the committed immutable placement from authenticated consensus read-back.
  losePlacementReply = false;
  const done = await runProvision({ ...saved, pending: undefined, registration: { ...saved.registration, placementRevision: snapshot.revision } }, adapter);
  assert.equal(done.phase, 'enabled'); assert.equal(creates, PER_GROUP_DOMAINS.length);
  groups = ok(await router.list_groups()); assert.equal(groups.length, 1); assert.equal(groups[0].accepting, true);
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, arg: IDL.encode([], []), sender: governor });
  assert.equal(ok(await router.read_group_registry('local')).placements[0].group_id, 'probe');
  console.log('PASS real local creation commit/reply loss, no duplicate create/install, closed placement failure, placement commit/reply loss, exact reconciliation, directory upgrade preservation');
  console.log('LIMIT: installation probes are not production domain wiring/health or live activation evidence');
} finally { if (pic) await pic.tearDown(); await server.stop(); }