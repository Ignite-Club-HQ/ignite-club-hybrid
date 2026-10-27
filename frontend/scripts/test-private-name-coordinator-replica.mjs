// Real identity write-coordinator orchestration across two disposable groups.
// Drives begin/advance/close through actual inter-canister calls, including an
// identity upgrade mid-Opening and a stopped sink during Releasing. No
// production transport or approvals.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as placementIdl } from '../src/lab/bindings/placement_registry/declarations/placement_registry.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as messagingIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as competitionIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as leagueIdl } from '../src/lab/bindings/mini_league_domain/declarations/mini_league_domain.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as blobIdl } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';

const root = resolve(import.meta.dirname, '../..');
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), outsider = p(2);
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const denied = async fn => { let d = false; try { const r = await fn(); d = !!r && 'Err' in r; } catch { d = true; } assert.ok(d, 'Must fail closed'); };
const phaseOf = w => Object.keys(w.phase)[0];
const motokoWasm = d => resolve(root, `backend/${d}/.mops/.build/${d}.wasm`);
const rustWasm = d => resolve(root, `target/wasm32-unknown-unknown/release/${d}.wasm`);
const domains = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain',
  'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];

const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/root/.cache/mops/pocket-ic/15.0.0/pocket-ic' });
let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const init = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]);
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: rustWasm('identity_access'), sender: governor, controllers: [governor], arg: init });
  identity.actor.setPrincipal(governor); ok(await identity.actor.register_account());
  await pic.updateCanisterSettings({ canisterId: identity.canisterId, sender: governor, environmentVariables:
    [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }, { name: 'IGNITE_PRIVATE_NAME_WRITER_REHEARSAL', value: '1' }] });
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: rustWasm('identity_access'), sender: governor, arg: init });
  const router = await pic.setupCanister({ idlFactory: routerIdl, wasm: rustWasm('shard_router'), sender: governor, controllers: [governor], arg: init });
  const placement = await pic.setupCanister({ idlFactory: placementIdl, wasm: rustWasm('placement_registry'), sender: governor, controllers: [governor], arg: init });
  router.actor.setPrincipal(governor);
  const subnet = await pic.getCanisterSubnetId(router.canisterId); assert.ok(subnet);

  const groups = [], supplemental = [], mediaStores = [];
  for (let n = 0; n < 2; n++) {
    const group = {};
    const env = [
      { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' },
      { name: 'IGNITE_PRIVATE_NAME_WRITER_REHEARSAL', value: '1' },
      { name: 'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL', value: '1' },
      { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: identity.canisterId.toText() },
      { name: 'IGNITE_PRIVATE_PROFILE_IDENTITY', value: identity.canisterId.toText() },
      { name: 'VETKD_KEY_NAME', value: 'key_1' }];
    for (const [d, idlFactory] of [['club_domain', clubIdl], ['messaging_domain', messagingIdl], ['competition_domain', competitionIdl], ['mini_league_domain', leagueIdl], ['pii_access_control', piiIdl]]) {
      // Clubs register their media store before the writer window closes writes.
      const service = await pic.setupCanister({ idlFactory, wasm: motokoWasm(d), sender: governor, controllers: [governor],
        arg: IDL.encode([IDL.Principal], [governor]), environmentVariables: d === 'club_domain' ? env.filter(e => e.name !== 'IGNITE_PRIVATE_NAME_WRITER_REHEARSAL') : env });
      service.actor.setPrincipal(governor); group[d] = service;
    }
    const store = await pic.setupCanister({ idlFactory: blobIdl, wasm: resolve(root, 'backend/media_blob_store/main.wasm'), sender: governor, controllers: [governor],
      environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }, { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' },
        { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: identity.canisterId.toText() }], arg: IDL.encode([IDL.Principal], [governor]) });
    ok(await group.club_domain.actor.register_media_quota_store(store.canisterId));
    await pic.updateCanisterSettings({ canisterId: group.club_domain.canisterId, sender: governor, environmentVariables: env });
    await pic.upgradeCanister({ canisterId: group.club_domain.canisterId, wasm: motokoWasm('club_domain'), sender: governor,
      arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    group.club_domain.actor.setPrincipal(governor);
    mediaStores.push(store);
    const mapped = domains.map((domain, i) => ({ domain, canister: group[domain] ? group[domain].canisterId : p(10 + n * 20 + i) }));
    let rev = await router.actor.version();
    rev = ok(await router.actor.register_group({ id: `g${n}`, target_alias: 'local', domains: mapped, accepting: false, max_clubs: 100,
      assigned_clubs: 0, heap_budget_bytes: 1_000_000n, heap_bytes: 0n, min_cycles: 1n, cycles: 0n, observed_at_ns: 0n, photo_store: [] }, rev));
    ok(await router.actor.register_group_placement({ group_id: `g${n}`, deployment_id: 'isolated-replica', deployment_revision: 1n,
      host: 'https://isolated.invalid', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet],
      additional_subnets_enabled: false, domains: mapped.map(d => ({ ...d, subnet })) }, rev));
    supplemental.push({ group_id: `g${n}`, domain: 'media_blob_store', canister: store.canisterId, subnet });
    groups.push(group);
  }
  supplemental.push({ group_id: 'g0', domain: 'identity_access', canister: identity.canisterId, subnet });
  supplemental.push({ group_id: 'g0', domain: 'placement_registry', canister: placement.canisterId, subnet });

  const actor = identity.actor;
  ok(await actor.set_club_authorities(groups.map(g => g.club_domain.canisterId)));
  ok(await actor.set_service_authorities(mediaStores.map(s => s.canisterId)));
  let binding = { registry: router.canisterId, registry_revision: await router.actor.version(), target_alias: 'local',
    deployment_id: 'isolated-replica', deployment_revision: 1n, host: 'https://isolated.invalid', network_kind: 'public_mainnet' };
  const revision = async () => ok(await actor.read_removal_history_manifest()).revision;
  ok(await actor.set_group_inventory_binding(binding, await revision()));
  ok(await actor.set_removal_supplemental_inventory(supplemental, await revision()));

  // Closed gates: outsider, stale history and writes before any window.
  const history = await revision();
  actor.setPrincipal(outsider); await denied(() => actor.begin_private_name_write_window('go-live', history)); actor.setPrincipal(governor);
  await denied(() => actor.begin_private_name_write_window('go-live', history + 1n));
  await denied(() => groups[0].club_domain.actor.set_identity_access_canister(outsider));

  // Begin: fences every original PII sink before any writer opens.
  let w = ok(await actor.begin_private_name_write_window('go-live', history));
  assert.equal(phaseOf(w), 'Fencing');
  assert.equal(w.sinks.length, 2); assert.equal(w.writers.length, 11);
  await denied(() => actor.begin_private_name_write_window('concurrent', history));
  for (const sink of w.sinks) w = ok(await actor.advance_private_name_write_window('go-live', sink));
  assert.equal(phaseOf(w), 'Opening');

  // Interrupt mid-Opening: upgrade the coordinator; the durable journal resumes.
  const half = Math.floor(w.writers.length / 2);
  for (const target of w.writers.slice(0, half)) w = ok(await actor.advance_private_name_write_window('go-live', target));
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: rustWasm('identity_access'), sender: governor });
  actor.setPrincipal(governor);
  w = ok(await actor.read_private_name_write_window('go-live'));
  assert.equal(phaseOf(w), 'Opening'); assert.equal(w.opened.length, half);
  for (const target of w.writers.slice(half)) w = ok(await actor.advance_private_name_write_window('go-live', target));
  assert.equal(phaseOf(w), 'Writing');

  // Authorized writes proceed inside the window; topology stays closed.
  ok(await groups[0].club_domain.actor.set_identity_access_canister(identity.canisterId));
  router.actor.setPrincipal(governor);
  await denied(() => router.actor.set_website_default_club_domain(outsider));

  // Close, seal every writer, then release sinks with a stopped-sink hold.
  w = ok(await actor.close_private_name_write_window('go-live'));
  assert.equal(phaseOf(w), 'Closing');
  await denied(() => groups[0].club_domain.actor.set_identity_access_canister(outsider));
  for (const target of w.writers) w = ok(await actor.advance_private_name_write_window('go-live', target));
  assert.equal(phaseOf(w), 'Releasing');
  const sink0 = groups.map(g => g.pii_access_control).find(s => s.canisterId.toText() === w.sinks[0].toText());
  await pic.stopCanister({ canisterId: sink0.canisterId, sender: governor });
  const signature = new Map(identityIdl({ IDL })._fields).get('advance_private_name_write_window'); assert.ok(signature);
  const held = await pic.client.submitCall({ canisterId: identity.canisterId, sender: governor, method: 'advance_private_name_write_window',
    payload: new Uint8Array(IDL.encode(signature.argTypes, ['go-live', w.sinks[0]])) });
  await pic.tick(3);
  await pic.startCanister({ canisterId: sink0.canisterId, sender: governor });
  w = ok({ Ok: IDL.decode(signature.retTypes, (await pic.client.awaitCall(held)).body)[0] });
  assert.equal(w.completed.length, 1);
  w = ok(await actor.advance_private_name_write_window('go-live', w.sinks[1]));
  assert.equal(phaseOf(w), 'Done');

  // Final receipts: both sinks completed with advanced epochs; reopen refused.
  for (const g of groups) {
    g.pii_access_control.actor.setPrincipal(identity.canisterId);
    const fence = ok(await g.pii_access_control.actor.read_private_name_release_fence(w.request));
    assert.equal(fence.completed, true); assert.ok(fence.release_epoch > 1n);
    await denied(() => g.pii_access_control.actor.open_private_name_writer_window(w.request));
  }
  // A later operation is a fresh generation, not a replay.
  const next = ok(await actor.begin_private_name_write_window('second-op', await revision()));
  assert.equal(phaseOf(next), 'Fencing');
  assert.ok(next.request.generation > w.request.generation);
  assert.notDeepEqual(next.request.inventory_digest, []);

  console.log('PASS: real identity coordinator fenced 2 sinks, opened/sealed 11 writers across two groups, resumed after a mid-Opening upgrade and a stopped-sink hold, kept topology closed, and completed with durable receipts.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }
