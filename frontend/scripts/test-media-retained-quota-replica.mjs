// Real local authority + two stores. No mainnet operations or activation.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wasm = resolve(root,'backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const clubWasm = resolve(root,'backend/club_domain/.mops/.build/club_domain.wasm');
const governor = Principal.fromUint8Array(new Uint8Array([1,1]));
const owner = Principal.fromUint8Array(new Uint8Array([2,1]));
const other = Principal.fromUint8Array(new Uint8Array([3,1]));
const ok = r => { assert.ok('Ok' in r,JSON.stringify(r,(_,v)=>typeof v==='bigint'?String(v):v)); return r.Ok; };
const denied = r => assert.ok('Err' in r);
const server = await PocketIcServer.start({binPath:'/tmp/pocket-ic'});
try {
 const pic = await PocketIc.create(server.getUrl());
 const oldClub = process.env.RETAINED_PRECHANGE_CLUB_WASM;
 const oldStore = process.env.RETAINED_PRECHANGE_STORE_WASM;
 assert.equal(Boolean(oldClub),Boolean(oldStore),'Old authority and stores must be tested together');
 const club = await pic.setupCanister({idlFactory:clubIdl,wasm:oldClub || clubWasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor]),environmentVariables:[{name:'IGNITE_MEDIA_RETAINED_LOCAL_REHEARSAL',value:'1'}]});
 const stores=[];
 for(let i=0;i<2;i++) stores.push(await pic.setupCanister({idlFactory,wasm:oldStore || wasm,sender:governor,controllers:[governor],environmentVariables:[{name:'GOVERNOR_PRINCIPAL',value:governor.toText()},{name:'IGNITE_MEDIA_RETAINED_LOCAL_REHEARSAL',value:'1'}]}));
 const c=club.actor; c.setPrincipal(governor);
 ok(await c.create_club('c','Test Club','test-club',[],[]));
 ok(await c.add_role_grant(owner,'c','player',[]));
 const subscription = {activated_at_ms:[],admin_pro_football_override:false,admin_pro_override:false,cancelled_at_ms:[],club_id:'c',expires_at_ms:[],is_pro:true,is_pro_football:false,is_trial:false,plan:'pro',team_limit:[],trial_ends_at_ms:[]};
 ok(await c.save_club_subscription(subscription));
 async function upload(actor,path,bytes) { const id=ok(await actor.begin_upload(path,'image/jpeg',BigInt(bytes.length),1)); ok(await actor.put_chunk(id,0,bytes)); ok(await actor.finalize_upload(id)); return id; }
 for(const store of stores) { store.actor.setPrincipal(governor); ok(await store.actor.set_club_domain_canister(club.canisterId)); ok(await c.register_media_quota_store(store.canisterId)); store.actor.setPrincipal(owner); }
 await upload(stores[0].actor,'clubs/c/photos/legacy',[1,2,3]);
 await upload(stores[1].actor,'clubs/c/vault/legacy',[4,5]);
 // Indexed + orphan/personal objects must all participate in exact totals.
 stores[1].actor.setPrincipal(governor); ok(await stores[1].actor.migrate_legacy_blob()); ok(await stores[1].actor.enable_stable_media_storage()); stores[1].actor.setPrincipal(owner);
 await upload(stores[1].actor,'users/u/orphan',[8]);
 if(oldClub && oldStore) {
   for(const store of stores) await pic.upgradeCanister({canisterId:store.canisterId,wasm,sender:governor,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
   await pic.upgradeCanister({canisterId:club.canisterId,wasm:clubWasm,sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
   assert.equal((await stores[0].actor.health()).total_bytes,3n);
   assert.equal((await stores[1].actor.health()).total_bytes,3n);
   assert.equal((await stores[1].actor.stable_storage_status()).indexed_count,2n);
   console.log('PASS: pinned pre-retained authority + legacy/indexed ciphertext survive additive migration into the new protocol.');
 }
 ok(await c.start_media_quota_cutover()); ok(await c.start_media_retained_cutover());
 for(const store of stores) { store.actor.setPrincipal(governor); ok(await store.actor.freeze_media_quota()); ok(await store.actor.freeze_retained_media()); }
 denied(await c.activate_media_retained_quota());
 stores[0].actor.setPrincipal(other); denied(await stores[0].actor.abort_upload('unknown')); denied(await stores[0].actor.finalize_upload('unknown'));
 for(const store of stores) {
   store.actor.setPrincipal(governor);
   denied(await store.actor.delete_blob('clubs/c/photos/legacy'));
   denied(await store.actor.migrate_legacy_blob());
   await assert.rejects(()=>store.actor.retained_snapshot_page({phase:{done:null},offset:0n,after:''}));
   ok(await c.import_media_quota_store(store.canisterId));
   for(let n=0;n<3;n++) ok(await c.import_media_retained_store(store.canisterId));
 }
 ok(await c.activate_media_quota());
 for(const store of stores) ok(await store.actor.enable_shared_media_quota());
 ok(await c.activate_media_retained_quota());
 denied(await c.register_media_quota_store(other));
 for(const store of stores) {ok(await store.actor.enable_retained_media_quota()); store.actor.setPrincipal(owner);}
 assert.deepEqual(ok(await c.read_club_retained_media_bytes('c')),{finalized:5n,pending:0n});
 c.setPrincipal(other); denied(await c.reserve_retained_media('attack','clubs/c/chat/a',1n)); denied(await c.read_club_retained_media_bytes('c')); c.setPrincipal(governor);
 const [a,b]=stores.map(s=>s.actor);
 const gallery=ok(await a.begin_upload('clubs/c/photos/new','image/jpeg',7n,1));
 const chat=ok(await b.begin_upload('clubs/c/chat/new','image/jpeg',11n,1));
 const branding=ok(await b.begin_upload('clubs/c/logos/new','image/jpeg',13n,1));
 assert.deepEqual(ok(await c.read_club_retained_media_bytes('c')),{finalized:5n,pending:31n});
 ok(await b.abort_upload(branding)); ok(await b.abort_upload(chat));
 ok(await a.put_chunk(gallery,0,new Uint8Array(7))); ok(await a.finalize_upload(gallery)); ok(await a.finalize_upload(gallery));
 assert.deepEqual(ok(await c.read_club_retained_media_bytes('c')),{finalized:12n,pending:0n});
 await upload(a,'clubs/c/photos/legacy',[9,9,9,9]);
 assert.equal(ok(await c.read_club_retained_media_bytes('c')).finalized,13n);
 ok(await a.delete_blob('clubs/c/photos/legacy'));
 assert.equal(ok(await c.read_club_retained_media_bytes('c')).finalized,9n);
 await upload(a,'clubs/c/photos/legacy',[7,7,7,7]);
 assert.equal(ok(await c.read_club_retained_media_bytes('c')).finalized,13n);
 // Failed deletion preparation cannot remove ciphertext or grant a refund.
 await pic.stopCanister({canisterId:club.canisterId,sender:governor});
 denied(await a.delete_blob('clubs/c/photos/legacy'));
 assert.ok((await a.get_content_hash('clubs/c/photos/legacy')).length);
 await pic.startCanister({canisterId:club.canisterId,sender:governor});
 denied(await a.begin_upload('clubs/c/photos/legacy','image/jpeg',1n,1));
 await pic.upgradeCanister({canisterId:stores[0].canisterId,wasm,sender:governor,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 ok(await a.delete_blob('clubs/c/photos/legacy'));
 assert.equal(ok(await c.read_club_retained_media_bytes('c')).finalized,9n);
 // Unknown commit survives upgrade and can never be cancelled/refunded.
 const interrupted=ok(await a.begin_upload('clubs/c/chat/interrupted','image/jpeg',3n,1)); ok(await a.put_chunk(interrupted,0,[6,6,6]));
 await pic.stopCanister({canisterId:club.canisterId,sender:governor}); denied(await a.finalize_upload(interrupted)); denied(await a.abort_upload(interrupted));
 await pic.upgradeCanister({canisterId:stores[0].canisterId,wasm,sender:governor,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 await pic.startCanister({canisterId:club.canisterId,sender:governor}); ok(await a.finalize_upload(interrupted)); ok(await a.finalize_upload(interrupted));
 assert.deepEqual(ok(await c.read_club_retained_media_bytes('c')),{finalized:12n,pending:0n});
 // Free monthly limits remain shared across stores, not refunded by deletion.
 // Recover both stores and both authority ledgers from one stopped checkpoint.
 const snapshotType=IDL.Record({id:IDL.Vec(IDL.Nat8),taken_at_timestamp:IDL.Nat64,total_size:IDL.Nat64});
 const snapshots=[]; const participants=[...stores,club];
 const expected=ok(await c.read_club_retained_media_bytes('c'));
 for(const participant of participants) await pic.stopCanister({canisterId:participant.canisterId,sender:governor});
 for(const participant of participants) {
   const reply=await pic.updateCall({canisterId:Principal.managementCanister(),method:'take_canister_snapshot',sender:governor,arg:IDL.encode([IDL.Record({canister_id:IDL.Principal,replace_snapshot:IDL.Opt(IDL.Vec(IDL.Nat8))})],[{canister_id:participant.canisterId,replace_snapshot:[]}])});
   const [snapshot]=IDL.decode([snapshotType],reply); snapshots.push({canisterId:participant.canisterId,snapshotId:snapshot.id});
 }
 for(const participant of [...participants].reverse()) await pic.startCanister({canisterId:participant.canisterId,sender:governor});
 await upload(b,'clubs/c/vault/after-checkpoint',[7,8]); ok(await a.delete_blob('clubs/c/photos/new'));
 assert.notDeepEqual(ok(await c.read_club_retained_media_bytes('c')),expected);
 for(const participant of participants) await pic.stopCanister({canisterId:participant.canisterId,sender:governor});
 for(const snapshot of snapshots) await pic.updateCall({canisterId:Principal.managementCanister(),method:'load_canister_snapshot',sender:governor,arg:IDL.encode([IDL.Record({canister_id:IDL.Principal,snapshot_id:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)})],[{canister_id:snapshot.canisterId,snapshot_id:snapshot.snapshotId,sender_canister_version:[]}])});
 for(const participant of [...participants].reverse()) await pic.startCanister({canisterId:participant.canisterId,sender:governor});
 assert.deepEqual(ok(await c.read_club_retained_media_bytes('c')),expected);
 assert.deepEqual(await b.get_content_hash('clubs/c/vault/after-checkpoint'),[]);
 assert.ok((await a.get_content_hash('clubs/c/photos/new')).length);
 console.log('PASS: coordinated controller snapshots restore both stores and retained/monthly ledgers before authority-first resume.');
 ok(await c.save_club_subscription({...subscription,is_pro:false,plan:'free'}));
 await pic.advanceTime(31*86_400_000); await pic.tick();
 for(let i=0;i<10;i++) await upload(i%2?a:b,`clubs/c/chat/free-${i}`,[1]);
 denied(await a.begin_upload('clubs/c/chat/over','image/jpeg',1n,1));
 await pic.advanceTime(181*86_400_000); await pic.tick(30);
 assert.deepEqual(ok(await c.read_club_retained_media_bytes('c')),{finalized:0n,pending:0n});
 // Production installs cannot start retained cutover even as governor.
 const production=await pic.setupCanister({idlFactory:clubIdl,wasm:clubWasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])}); production.actor.setPrincipal(governor); denied(await production.actor.start_media_retained_cutover());
 console.log('PASS: authenticated exact two-store baseline, combined pending/retained accounting, branding, replacement, deletion preparation/outage/upgrade, commit recovery, free monthly limits, retention credits and production activation refusal.');
} finally {await server.stop();}
