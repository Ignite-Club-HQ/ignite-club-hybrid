// Real local authority + two stores. No mainnet operations or activation.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
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
 for(let i=0;i<2;i++) stores.push(await pic.setupCanister({idlFactory,wasm:oldStore || wasm,sender:governor,controllers:[governor],environmentVariables:[{name:'GOVERNOR_PRINCIPAL',value:governor.toText()},{name:'IGNITE_MEDIA_RETAINED_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_MEDIA_SLOT_LOCAL_REHEARSAL',value:'1'}]}));
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
 // Expired, acknowledged authority operations retire without resurrecting
 // reservations; store cleanup can follow authority cleanup in either order.
 let retired = 0, cursor = '';
 do { const page=ok(await c.retire_retained_media_records(cursor)); retired += Number(page.removed); cursor=page.cursor; } while(cursor);
 assert.ok(retired > 0);
 c.setPrincipal(stores[0].canisterId);
 denied(await c.reserve_retained_media(gallery,'clubs/c/photos/new',7n));
 assert.equal(ok(await c.cancel_retained_media(gallery,'c','clubs/c/photos/new',7n)).state.released,null);
 const currentEpoch=BigInt(Math.floor((await pic.getTime())/(30*86_400_000)));
 denied(await c.reserve_media_quota(gallery,'c','gallery_photo',7n,currentEpoch));
 denied(await c.cancel_media_quota(gallery,'c','gallery_photo',7n,currentEpoch));
 const expiredUnknown='r1:1:999999999:upload';
 assert.equal(ok(await c.cancel_retained_media(expiredUnknown,'c','clubs/c/photos/absent',1n)).state.released,null);
 denied(await c.reserve_retained_media(expiredUnknown,'clubs/c/photos/absent',1n));
 assert.deepEqual(ok(await c.read_club_retained_media_bytes('c')),{finalized:0n,pending:0n});
 ok(await c.acknowledge_retained_media(gallery));
 c.setPrincipal(governor);
 for(const store of stores) { store.actor.setPrincipal(governor); ok(await store.actor.reconcile_upload_operations('')); ok(await store.actor.retire_upload_outcomes('')); }
 // Activate only the local growth gate after the existing exact baseline.
 await pic.updateCanisterSettings({canisterId:club.canisterId,sender:governor,environmentVariables:[{name:'IGNITE_MEDIA_RETAINED_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_MEDIA_GROWTH_LOCAL_REHEARSAL',value:'1'}]});
 await pic.upgradeCanister({canisterId:club.canisterId,wasm:clubWasm,sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 denied(await c.create_club('blocked','No capacity yet','blocked',[],[]));
 const overhead=6_553_600_000n, base=5_368_709_120n;
 denied(await c.configure_media_growth(overhead+base*2n+2048n,0n,1024n,['wrong']));
 ok(await c.configure_media_growth(overhead+base*2n+2048n,0n,1024n,['c']));
 denied(await c.configure_media_growth(overhead+base*4n,0n,1024n,['c']));
 ok(await c.save_club_subscription(subscription));
 ok(await c.create_club('c2','Second club','second',[],[]));
 denied(await c.create_club('c3','No more room','third',[],[]));
 denied(await c.save_club_subscription({...subscription,club_id:'c2'}));
 assert.equal(ok(await c.get_club_subscription('c2')).length,0);
 await pic.upgradeCanister({canisterId:club.canisterId,wasm:clubWasm,sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 denied(await c.create_club('c3','Still no room','third',[],[]));
 // Same real authority and stores, now backed by the router's physical ledger.
 const routerWasm=resolve(root,'target/wasm32-unknown-unknown/release/shard_router.wasm');
 const router=await pic.setupCanister({idlFactory:routerIdl,wasm:routerWasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
 const r=router.actor; r.setPrincipal(governor);
 const domains=['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'].map((domain,i)=>({domain,canister:domain==='club_domain'?club.canisterId:Principal.fromUint8Array(new Uint8Array([50+i,1]))}));
 let revision=ok(await r.register_group({id:'g',target_alias:'local',domains,accepting:true,max_clubs:100,assigned_clubs:0,heap_budget_bytes:1000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n,photo_store:[stores[0].canisterId]},0n));
 revision=ok(await r.record_group_health('g',1n,2n,revision));
 for(const id of ['c','c2']) { const assigned=ok(await r.assign_new_club_group(id,'local',revision)); revision=assigned.revision; }
 await pic.updateCanisterSettings({canisterId:router.canisterId,sender:governor,environmentVariables:[{name:'IGNITE_MEDIA_GROWTH_LOCAL_REHEARSAL',value:'1'}]});
 await pic.updateCanisterSettings({canisterId:club.canisterId,sender:governor,environmentVariables:[{name:'IGNITE_MEDIA_RETAINED_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_MEDIA_GROWTH_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_MEDIA_ROUTER_GROWTH_LOCAL_REHEARSAL',value:'1'}]});
 await pic.upgradeCanister({canisterId:club.canisterId,wasm:clubWasm,sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 // Configuration refuses a partial baseline; no silent reserve for omitted clubs.
 denied(await r.configure_group_media_growth('g',overhead+base*2n+2048n,overhead,2048n,[['c',base*2n]],revision));
 ok(await r.configure_group_media_growth('g',overhead+base*2n+2048n,overhead,2048n,[['c',base*2n],['c2',2048n]],revision));
 // An aggregate budget cannot admit new clubs or publish increased promises.
 denied(await r.place_my_new_club('00000000-0000-4000-8000-000000000002','local'));
 const baseline=[['c',base*2n],['c2',2048n]];
 denied(await r.configure_store_media_growth('g',stores[1].canisterId,overhead+base*2n+2048n,overhead,baseline,revision,1n));
 denied(await r.configure_store_media_growth('g',stores[0].canisterId,overhead+base*2n+2048n,overhead,[['c',base*2n]],revision,1n));
 denied(await r.configure_store_media_growth('g',stores[0].canisterId,overhead+base*2n+2048n,overhead,[['c',base*2n-1n],['c2',2048n]],revision,1n));
 r.setPrincipal(other);
 denied(await r.configure_store_media_growth('g',stores[0].canisterId,overhead+base*2n+2048n,overhead,baseline,revision,1n));
 r.setPrincipal(governor);
 ok(await r.configure_store_media_growth('g',stores[0].canisterId,overhead+base*2n+2048n,overhead,baseline,revision,1n));
 denied(await r.configure_store_media_growth('g',stores[0].canisterId,overhead+base*4n,overhead,baseline,revision,2n));
 denied(await c.save_club_subscription(subscription)); // binding mandatory
 ok(await c.configure_media_growth_router(router.canisterId,'g','local'));
 denied(await c.configure_media_growth_router(router.canisterId,'foreign','local'));
 ok(await c.save_club_subscription(subscription));
 r.setPrincipal(other); denied(await r.reserve_group_media_growth('g','local','c',base*2n)); r.setPrincipal(governor);
 await pic.stopCanister({canisterId:router.canisterId,sender:governor});
 denied(await c.save_club_subscription({...subscription,is_pro:false,plan:'free'}));
 assert.equal(ok(await c.get_club_subscription('c'))[0].is_pro,true);
 await pic.startCanister({canisterId:router.canisterId,sender:governor});
 ok(await c.save_club_subscription({...subscription,is_pro:false,plan:'free'}));
 // A definite outage does not refund or duplicate commitments on retry.
 assert.equal(ok(await c.get_club_subscription('c'))[0].is_pro,false);
 await pic.upgradeCanister({canisterId:router.canisterId,wasm:routerWasm,sender:governor});
 ok(await c.save_club_subscription(subscription));
 denied(await r.place_my_new_club('00000000-0000-4000-8000-000000000001','local'));
 console.log('PASS: same-authority router reservations, exact baseline, caller/group binding, outage publication denial, upgrade persistence and exhausted new-club placement.');
 console.log('PASS: acknowledged expiry retirement rejects replay; atomic growth reservations gate real creation/Pro grants and survive upgrade.');
 // Production installs cannot start retained cutover even as governor.
 const production=await pic.setupCanister({idlFactory:clubIdl,wasm:clubWasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])}); production.actor.setPrincipal(governor); denied(await production.actor.start_media_retained_cutover());
 denied(await production.actor.configure_media_growth(overhead+base*4n,0n,1024n,[]));
 denied(await production.actor.configure_media_growth_router(router.canisterId,'g','local'));
 const productionRouter=await pic.setupCanister({idlFactory:routerIdl,wasm:routerWasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
 productionRouter.actor.setPrincipal(governor);
 denied(await productionRouter.actor.configure_group_media_growth('g',100n,0n,1n,[],0n));
 denied(await productionRouter.actor.configure_store_media_growth('g',stores[0].canisterId,100n,0n,[],0n,1n));
 console.log('PASS: authenticated exact two-store baseline, combined pending/retained accounting, branding, replacement, deletion preparation/outage/upgrade, commit recovery, free monthly limits, retention credits and production activation refusal.');
} finally {await server.stop();}
