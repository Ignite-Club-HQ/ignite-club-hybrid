// Isolated registry metadata only; domain IDs are placeholders, not live services.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as blobIdl } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), outsider = p(2);
const domains = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain',
  'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const denied = r => assert.ok('Err' in r, 'Expected explicit denial');
const identityWasm = resolve('target/wasm32-unknown-unknown/release/identity_access.wasm');
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/tmp/pocket-ic' }); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const args = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]);
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: identityWasm, sender: governor, controllers: [governor],
    environmentVariables: [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }], arg: args });
  const router = await pic.setupCanister({ idlFactory: routerIdl, wasm: resolve('target/wasm32-unknown-unknown/release/shard_router.wasm'),
    sender: governor, controllers: [governor], arg: args });
  const actor = identity.actor; actor.setPrincipal(governor); router.actor.setPrincipal(governor);
  const subnet = await pic.getCanisterSubnetId(router.canisterId); assert.ok(subnet);
  const clubs = [], mappedGroups = [], mediaStores = [], supplemental = [];
  for (let n = 0; n < 2; n++) {
    const clubFixture = await pic.setupCanister({ idlFactory: clubIdl, wasm: '/tmp/club_domain-admission.wasm', sender: governor, controllers: [governor],
      environmentVariables: [{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()}], arg:IDL.encode([IDL.Principal],[governor]) });
    clubFixture.actor.setPrincipal(governor);
    const club = clubFixture.canisterId; clubs.push(club);
    const store = await pic.setupCanister({idlFactory:blobIdl,wasm:'/tmp/removal/media_blob_store.wasm',sender:governor,controllers:[governor],
      environmentVariables:[{name:'GOVERNOR_PRINCIPAL',value:governor.toText()},{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()}],arg:IDL.encode([IDL.Principal],[governor])});
    ok(await clubFixture.actor.register_media_quota_store(store.canisterId)); mediaStores.push({store,clubFixture});
    supplemental.push({group_id:`g${n}`,domain:'media_blob_store',canister:store.canisterId,subnet});
    const mapped = domains.map((domain, i) => ({ domain, canister: i === 0 ? club : p(10 + n * 20 + i) })); mappedGroups.push(mapped);
    let rev = await router.actor.version();
    rev = ok(await router.actor.register_group({ id: `g${n}`, target_alias: 'local', domains: mapped, accepting: false, max_clubs: 100,
      assigned_clubs: 0, heap_budget_bytes: 1_000_000n, heap_bytes: 0n, min_cycles: 1n, cycles: 0n, observed_at_ns: 0n, photo_store: [] }, rev));
    ok(await router.actor.register_group_placement({ group_id: `g${n}`, deployment_id: 'isolated-replica', deployment_revision: 1n,
      host: 'https://isolated.invalid', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet],
      additional_subnets_enabled: false, domains: mapped.map(d => ({ ...d, subnet })) }, rev));
  }
  ok(await actor.set_club_authorities(clubs)); ok(await actor.set_service_authorities([mappedGroups[0][1].canister]));
  const revision = async () => ok(await actor.read_removal_history_manifest()).revision;
  denied(await actor.read_group_inventory_evidence(await revision()));
  let binding = { registry: router.canisterId, registry_revision: await router.actor.version(), target_alias: 'local',
    deployment_id: 'isolated-replica', deployment_revision: 1n, host: 'https://isolated.invalid', network_kind: 'public_mainnet' };
  const originalHistory = await revision(); ok(await actor.set_group_inventory_binding(binding, originalHistory));
  denied(await actor.read_group_inventory_evidence(originalHistory)); let history = await revision();
  const evidence = ok(await actor.read_group_inventory_evidence(history));
  assert.equal(evidence.snapshot.groups.length, 2); assert.equal(evidence.snapshot.placements.length, 2);
  assert.equal(evidence.snapshot.groups.reduce((n, g) => n + g.domains.length, 0), 26);
  assert.equal(evidence.binding.registry.toText(), router.canisterId.toText()); assert.equal(evidence.history_revision, history);
  actor.setPrincipal(outsider); denied(await actor.read_group_inventory_evidence(history)); denied(await actor.set_group_inventory_binding(binding, history));
  actor.setPrincipal(Principal.anonymous()); denied(await actor.read_group_inventory_evidence(history)); actor.setPrincipal(governor);
  for (const change of [{ registry: p(99) }, { deployment_id: 'foreign' }, { registry_revision: binding.registry_revision - 1n }]) {
    denied(await actor.set_group_inventory_binding({ ...binding, ...change }, history));
  }
  assert.equal(await revision(), history, 'Rejected substitutions leave history intact');
  const newer = ok(await router.actor.record_group_health('g0', 0n, 1n, binding.registry_revision));
  denied(await actor.read_group_inventory_evidence(history)); binding = { ...binding, registry_revision: newer };
  ok(await actor.set_group_inventory_binding(binding, history)); history = await revision(); ok(await actor.read_group_inventory_evidence(history));
  // Stop the actual registry before submitting a read, mutate readers, resume.
  await pic.stopCanister({ canisterId: router.canisterId, sender: governor });
  const signature = new Map(identityIdl({ IDL })._fields).get('read_group_inventory_evidence'); assert.ok(signature);
  const message = await pic.client.submitCall({ canisterId: identity.canisterId, sender: governor, method: 'read_group_inventory_evidence',
    payload: new Uint8Array(IDL.encode(signature.argTypes, [history])) });
  await pic.tick(1); ok(await actor.set_service_authorities([mappedGroups[0][1].canister, mappedGroups[1][1].canister]));
  await pic.startCanister({ canisterId: router.canisterId, sender: governor });
  denied(IDL.decode(signature.retTypes, (await pic.client.awaitCall(message)).body)[0]);
  history = await revision(); ok(await actor.read_group_inventory_evidence(history));
  // Identity fetches operator-authorized store lists from both REAL clubs.
  ok(await actor.set_service_authorities([mappedGroups[0][1].canister,mappedGroups[1][1].canister,...mediaStores.map(s=>s.store.canisterId)]));
  history=await revision(); denied(await actor.read_group_inventory_evidence(history));
  denied(await actor.read_removal_inventory_evidence(history));
  ok(await actor.set_removal_supplemental_inventory(supplemental.slice(0,1),history)); history=await revision();
  denied(await actor.read_removal_inventory_evidence(history));
  ok(await actor.set_removal_supplemental_inventory(supplemental,history)); history=await revision();
  let complete=ok(await actor.read_removal_inventory_evidence(history));
  assert.equal(complete.media.length,2); assert.equal(complete.supplemental.length,2);
  assert.deepEqual(complete.media.map(e=>e.registry.stores[0].toText()).sort(),mediaStores.map(e=>e.store.canisterId.toText()).sort());
  mediaStores[0].clubFixture.actor.setPrincipal(outsider);
  denied(await mediaStores[0].clubFixture.actor.read_removal_media_registry());
  mediaStores[0].clubFixture.actor.setPrincipal(governor);
  denied(await mediaStores[0].clubFixture.actor.read_removal_media_registry()); // governor uses existing operator endpoint
  ok(await mediaStores[0].clubFixture.actor.read_media_quota_store_registry());
  actor.setPrincipal(outsider); denied(await actor.read_removal_inventory_evidence(history)); actor.setPrincipal(governor);
  denied(await actor.set_removal_supplemental_inventory(supplemental.slice(0,1),history));
  // Stop a real media registry, mutate pinned inventory during the await.
  await pic.stopCanister({canisterId:clubs[0],sender:governor});
  const completeSignature=new Map(identityIdl({IDL})._fields).get('read_removal_inventory_evidence'); assert.ok(completeSignature);
  const held=await pic.client.submitCall({canisterId:identity.canisterId,sender:governor,method:'read_removal_inventory_evidence',payload:new Uint8Array(IDL.encode(completeSignature.argTypes,[history]))});
  await pic.tick(3);
  ok(await actor.set_removal_supplemental_inventory(supplemental,history));
  await pic.startCanister({canisterId:clubs[0],sender:governor});
  denied(IDL.decode(completeSignature.retTypes,(await pic.client.awaitCall(held)).body)[0]);
  history=await revision(); complete=ok(await actor.read_removal_inventory_evidence(history));
  // Additional store registered later MUST appear in the pinned placements.
  const third=await pic.createCanister({sender:governor,controllers:[governor]});
  ok(await mediaStores[0].clubFixture.actor.register_media_quota_store(third));
  denied(await actor.read_removal_inventory_evidence(history));
  supplemental.push({group_id:'g0',domain:'media_blob_store',canister:third,subnet});
  ok(await actor.set_removal_supplemental_inventory(supplemental,history)); history=await revision();
  assert.equal(ok(await actor.read_removal_inventory_evidence(history)).media[0].registry.stores.length,2);
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: identityWasm, sender: governor, wasmMemoryPersistence: 'keep' });
  denied(await actor.read_group_inventory_evidence(history)); history = await revision();
  assert.equal(ok(await actor.read_removal_inventory_evidence(history)).groups.binding.registry.toText(), router.canisterId.toText());
  // A missing service reader (including media) cannot silently disappear.
  ok(await actor.set_service_authorities([mappedGroups[0][1].canister, mappedGroups[1][1].canister,...mediaStores.map(s=>s.store.canisterId), p(99)]));
  history = await revision(); denied(await actor.read_removal_inventory_evidence(history));
  // Repair the deliberate missing-reader case by append-only placement, then
  // freeze an actual account. No receiver acknowledgements are fabricated.
  supplemental.push({group_id:'g0',domain:'vault_domain',canister:p(99),subnet});
  ok(await actor.set_removal_supplemental_inventory(supplemental,history)); history=await revision();
  actor.setPrincipal(outsider); const removedAccount=ok(await actor.register_account()); actor.setPrincipal(governor);
  const staged=[];
  for (const {store} of mediaStores) {
    store.actor.setPrincipal(outsider);
    const upload=ok(await store.actor.begin_upload('clubs/local/gallery/staged.jpg','image/jpeg',1n,1));
    ok(await store.actor.put_chunk(upload,0,new Uint8Array([42]))); staged.push(upload);
  }
  history=await revision();
  const intent=ok(await actor.begin_account_removal(removedAccount.id,history));
  assert.equal(intent.generation,1n); assert.equal(intent.inventory_digest.length,32);
  assert.equal(intent.targets.length,30); // 26 domains + 3 stores + 1 legacy service
  assert.deepEqual(intent.subjects.map(p=>p.toText()),[outsider.toText()]);
  const snapshotType=IDL.Record({id:IDL.Vec(IDL.Nat8),taken_at_timestamp:IDL.Nat64,total_size:IDL.Nat64});
  async function management(method,type,input,outputs=[]) {
    const result=await pic.updateCall({canisterId:Principal.managementCanister(),method,arg:IDL.encode([type],[input]),sender:governor});
    return IDL.decode(outputs,result);
  }
  // Real identity -> each actual receiver, not a supplied/browser receipt.
  for (const [n,{store}] of mediaStores.entries()) {
    const receipt=ok(await actor.advance_account_removal_receiver(removedAccount.id,store.canisterId));
    assert.equal(receipt.outstanding,0n);
    assert.equal(receipt.receiver.toText(),store.canisterId.toText());
    assert.equal(receipt.request.generation,intent.generation);
    store.actor.setPrincipal(outsider);
    await assert.rejects(()=>store.actor.finalize_upload(staged[n]));
    assert.equal((await store.actor.http_request({url:'/clubs/local/gallery/staged.jpg',method:'GET',headers:[],body:new Uint8Array()})).status_code,404);
    await pic.upgradeCanister({canisterId:store.canisterId,wasm:'/tmp/removal/media_blob_store.wasm',sender:governor,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    await assert.rejects(()=>store.actor.begin_upload('after.jpg','image/jpeg',1n,1));
    assert.deepEqual(ok(await actor.advance_account_removal_receiver(removedAccount.id,store.canisterId)),receipt);
    // Actual management snapshot/reload of the fenced receiver. Identity stays
    // advanced; this is NOT proof of safe coordinator/history rollback.
    await pic.stopCanister({canisterId:store.canisterId,sender:governor});
    const [snapshot]=await management('take_canister_snapshot',IDL.Record({canister_id:IDL.Principal,replace_snapshot:IDL.Opt(IDL.Vec(IDL.Nat8))}),{canister_id:store.canisterId,replace_snapshot:[]},[snapshotType]);
    await management('load_canister_snapshot',IDL.Record({canister_id:IDL.Principal,snapshot_id:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)}),{canister_id:store.canisterId,snapshot_id:snapshot.id,sender_canister_version:[]});
    await pic.startCanister({canisterId:store.canisterId,sender:governor});
    await assert.rejects(()=>store.actor.finalize_upload(staged[n]));
    assert.deepEqual(ok(await actor.advance_account_removal_receiver(removedAccount.id,store.canisterId)),receipt);
  }
  denied(await actor.advance_account_removal_receiver(removedAccount.id,p(98)));
  denied(await actor.advance_account_removal_receiver(removedAccount.id,third)); // missing receiver cannot fake drain
  actor.setPrincipal(outsider); denied(await actor.whoami()); denied(await actor.register_account()); actor.setPrincipal(governor);
  actor.setPrincipal(mappedGroups[0][1].canister); assert.ok('Denied' in ok(await actor.read_principal_eligibility(outsider)).decision); actor.setPrincipal(governor);
  // Registry drift/config changes cannot replace an already frozen job.
  denied(await actor.set_service_authorities([mappedGroups[0][1].canister]));
  denied(await actor.set_removal_supplemental_inventory(supplemental,await revision()));
  assert.deepEqual(ok(await actor.begin_account_removal(removedAccount.id,0n)),intent);
  await pic.upgradeCanister({canisterId:identity.canisterId,wasm:identityWasm,sender:governor});
  assert.deepEqual(ok(await actor.read_account_removal_intent(removedAccount.id)),intent);
  actor.setPrincipal(outsider); denied(await actor.whoami()); denied(await actor.register_account()); actor.setPrincipal(governor);
  assert.deepEqual(ok(await actor.begin_account_removal(removedAccount.id,0n)),intent);
  denied(await actor.rekey_principal(outsider,p(98),false));
  const production = await pic.setupCanister({ idlFactory: identityIdl, wasm: identityWasm, sender: governor, controllers: [governor], arg: args });
  production.actor.setPrincipal(governor); denied(await production.actor.set_group_inventory_binding(binding, 0n));
  denied(await production.actor.read_group_inventory_evidence(0n));
  denied(await production.actor.set_removal_supplemental_inventory(supplemental,0n)); denied(await production.actor.read_removal_inventory_evidence(0n));
  denied(await production.actor.begin_account_removal(removedAccount.id,0n)); denied(await production.actor.read_account_removal_intent(removedAccount.id));
  console.log('PASS: real identity/router/two-club registry reads, additional-store omission, supplemental service coverage, stale interrupted media replies, protected relay, upgrade preservation and closed production gates. Domain metadata placeholders do not prove full two-group drain.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }