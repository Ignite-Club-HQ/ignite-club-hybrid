// Local-only service rehearsal, never production wiring or activation.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { adaptLocalAccountReads } from '../src/live/accountReadAdapter.mjs';
import { createPushQueueIdl, notificationKey } from '../../scripts/icp-push-contract.mjs';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as chatIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as vaultIdl } from '../src/lab/bindings/vault_domain/declarations/vault_domain.did.js';
import { idlFactory as queueIdl } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
const p = n => Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor = p(1), victim = p(2), stranger = p(3);
const ok = r => { assert.ok('Ok' in r, String(r.Err)); return r.Ok; };
const denied = async fn => { let blocked = false; try { const r = await fn(); blocked = r && 'Err' in r; } catch { blocked = true; } assert.ok(blocked, 'Removed/unavailable subject must be blocked'); };
const env = [{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}];
const server = await PocketIcServer.start(); let pic;
try {
 pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
 const identity = await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,controllers:[governor],environmentVariables:env,arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
 const services=[];
 for (const [name,idlFactory] of [['messaging_domain',chatIdl],['pii_access_control',piiIdl],['vault_domain',vaultIdl],['notification_queue',queueIdl]]) {
  services.push(await pic.setupCanister({idlFactory,wasm:process.env[name.toUpperCase()+'_WASM'],sender:governor,controllers:[governor],environmentVariables:[...env,{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()},...(name==='pii_access_control'?[{name:'VETKD_KEY_NAME',value:'key_1'}]:[])],arg:IDL.encode([IDL.Principal],[governor])}));
 }
 const [chat,pii,vault,queue]=services.map(s=>s.actor), id=identity.actor;
 const extra=[];
 for (const name of ['club_domain','events_domain','competition_domain','mini_league_domain','club_points_domain','media_metadata','insights_domain','media_blob_store']) {
  const {idlFactory}=await import(`../src/lab/bindings/${name}/declarations/${name}.did.js`);
  const service=await pic.setupCanister({idlFactory,wasm:process.env[name.toUpperCase()+'_WASM'],sender:governor,controllers:[governor],environmentVariables:[...env,{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()}],arg:IDL.encode([IDL.Principal],[governor])});
  extra.push({name,...service});
 }
 const [club,events,competition,league,points,media,insights,blob]=extra.map(s=>s.actor);
 id.setPrincipal(governor); ok(await id.register_account()); ok(await id.set_service_authorities([...services,...extra].map(s=>s.canisterId)));
 id.setPrincipal(victim); const account=ok(await id.register_account());
 id.setPrincipal(stranger); ok(await id.register_account());
 id.setPrincipal(victim); assert.ok('Err' in await id.read_service_account(stranger));
 for (const actor of [club,events,competition,league,points,media,insights,blob]) actor.setPrincipal(governor);
 const comp=ok(await competition.create_competition('club','Local competition','2026'));
 const mini=ok(await league.create_mini_league('club','Local league',[],[],5,3,10,['red','green'],true));
 ok(await league.grant_role(victim,'league_admin','club',[]));
 ok(await points.grant_role(victim,'club_admin','club',[]));
 points.setPrincipal(victim);
 ok(await points.award_points('club',{User:victim.toText()},'attendance','local',7,'Local award',[],[],[]));
 assert.equal(ok(await points.read_account_get_user_points('club',victim.toText())),7);
 media.setPrincipal(victim);
 const asset=ok(await media.register_asset('club','photo','image/jpeg','local-checksum','clubs/club/local.jpg','private',99999999999999n));
 assert.equal((await media.read_account_get_asset(asset.id))[0].id,asset.id);
 league.setPrincipal(victim); assert.equal(ok(await league.read_account_get_mini_league(mini.id)).id,mini.id);
 club.setPrincipal(victim); assert.deepEqual(await club.read_account_my_role_grants(),[]);
 events.setPrincipal(victim); assert.deepEqual(ok(await events.read_account_list_my_viewed_event_ids([])),[]);
 insights.setPrincipal(victim); ok(await insights.record_web_vital('LCP',12,'good','/local'));
 assert.equal(await league.read_account_verify_child_guardian(victim,'unknown'),false,'A human cannot invoke the self-only guardian helper');
 // This fixture tests personal admission independently of club membership;
 // actual vault/club/photo authority and club removal are exercised below.
 chat.setPrincipal(governor); const conversation=ok(await chat.create_conversation('dm',[],[victim,governor]));
 chat.setPrincipal(victim); ok(await chat.send_message(conversation.id,'local private message','m1',[],[]));
 assert.equal(ok(await chat.read_account_list_messages_page(conversation.id,[],10)).messages.length,1);
 await denied(()=>chat.list_messages_page(conversation.id,[],10));
 pii.setPrincipal(victim); ok(await pii.register_pii('private','name',[1,2,3],victim));
 assert.equal(ok(await pii.get_encrypted_pii_batch(['private'],'name','read','local')).length,1);
 vault.setPrincipal(governor); ok(await vault.grant_role(victim,'club_admin',['club'],[]));
 vault.setPrincipal(victim); ok(await vault.create_folder('f','club',[],[],'local',[],[],[],0,[],[]));
 queue.setPrincipal(governor); ok(await queue.enqueue('n',victim.toText(),'club','event','local','k'));
 ok(await queue.enqueue('malformed','legacy-account-id','club','event','legacy','legacy')); 
 queue.setPrincipal(victim); assert.equal(ok(await queue.list_inbox(victim.toText(),[],10)).length,1);
 queue.setPrincipal(stranger); assert.ok('Err' in await queue.clear_inbox(victim.toText(),[]));
 queue.setPrincipal(victim); await queue.register_device_token('android','local-test-token',[],[]);
 queue.setPrincipal(governor); assert.equal(ok(await queue.list_device_tokens([victim.toText()])).length,1);
 queue.setPrincipal(governor); ok(await queue.set_messaging_domain_canister(services[0].canisterId));
 chat.setPrincipal(governor); ok(await chat.set_notification_queue_canister(services[3].canisterId));
 queue.setPrincipal(stranger); await denied(()=>queue.read_account_get_digest({Club:null},conversation.id,0n,10));
 queue.setPrincipal(victim); assert.deepEqual(ok(await queue.read_account_get_digest({Club:null},conversation.id,0n,10)),[]);
 // Focused deterministic interruption tests: the fixture exposes observed
 // wait state, so one arbitrary tick is never treated as proof of a pause.
 const delayIdl = ({IDL}) => IDL.Service({
  hold_on:IDL.Func([IDL.Nat],[],[]), release:IDL.Func([],[],[]),
  progress:IDL.Func([],[IDL.Nat,IDL.Bool],['query']), pulse:IDL.Func([],[],[])
 });
 const delayed=await pic.setupCanister({idlFactory:delayIdl,wasm:process.env.DELAYED_PERMISSION_WASM,sender:governor,controllers:[governor]});
 const waitForHold=async n=>{
  for(let round=0;round<60;round++) {
   await pic.tick(1);
   const [calls,released]=await delayed.actor.progress();
   if(calls===BigInt(n)&&!released) return;
  }
  assert.fail('Permission callback did not reach its observed hold point');
 };
 vault.setPrincipal(governor); ok(await vault.set_competition_domain_canister(delayed.canisterId));
 // The installed deferred actor uses an async Promise executor that loses
 // rejects on trapped callbacks. Use its underlying bounded submit/await API.
 const deferred=async(factory,canisterId,method,args)=>{
  const signature=factory({IDL})._fields.find(([name])=>name===method)?.[1];
  assert.ok(signature,'Test method must exist in the actual contract');
  const message=await pic.client.submitCall({canisterId,sender:victim,method,payload:new Uint8Array(IDL.encode(signature.argTypes,args))});
  return async()=>{const response=await pic.client.awaitCall(message);return IDL.decode(signature.retTypes,response.body)[0];};
 };
 const folderArgs=name=>[name,'club',[],[],name,[],[],['competition'],0,[],[]];
 // Positive control: exact same delegated permission actually creates a row.
 vault.setPrincipal(victim); ok(await vault.create_folder(...folderArgs('control')));
 await delayed.actor.hold_on(2n);
 const interruptedFolder=await deferred(vaultIdl,services[2].canisterId,'create_folder',folderArgs('interrupted'));
 await waitForHold(2);
 id.setPrincipal(governor); ok(await id.set_account_status(account.id,{Suspended:null}));
 await delayed.actor.release(); await denied(interruptedFolder);
 ok(await id.set_account_status(account.id,{Active:null}));
 vault.setPrincipal(victim);
 assert.equal(ok(await vault.create_folder(...folderArgs('interrupted'))).id,'interrupted','Denied callback must not have inserted the folder');
 // Replacing the authority invalidates the old otherwise-permitting reply.
 await delayed.actor.hold_on(2n);
 const replacedFolder=await deferred(vaultIdl,services[2].canisterId,'create_folder',folderArgs('replaced'));
 await waitForHold(2);
 vault.setPrincipal(governor); ok(await vault.set_competition_domain_canister(extra[2].canisterId));
 await delayed.actor.release(); await denied(replacedFolder);
 ok(await vault.set_competition_domain_canister(delayed.canisterId));
 vault.setPrincipal(victim); ok(await vault.create_folder(...folderArgs('replaced')));
 // Upload quota/subscription waits must not admit an account removed mid-wait.
 await pic.updateCanisterSettings({canisterId:extra[7].canisterId,sender:governor,environmentVariables:[...env,{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()},{name:'GOVERNOR_PRINCIPAL',value:governor.toText()}]});
 blob.setPrincipal(governor); ok(await blob.set_club_domain_canister(delayed.canisterId));
 blob.setPrincipal(victim); const controlUpload=ok(await blob.begin_upload('clubs/club/gallery/control.jpg','image/jpeg',1n,1));
 ok(await blob.abort_upload(controlUpload));
 const blobFactory=(await import('../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js')).idlFactory;
 await delayed.actor.hold_on(1n);
 const interruptedUpload=await deferred(blobFactory,extra[7].canisterId,'begin_upload',['clubs/club/gallery/interrupted.jpg','image/jpeg',1n,1]);
 await waitForHold(1);
 ok(await id.set_account_status(account.id,{Suspended:null}));
 await delayed.actor.release(); await denied(interruptedUpload);
 ok(await id.set_account_status(account.id,{Active:null}));
 const retried=ok(await blob.begin_upload('clubs/club/gallery/interrupted.jpg','image/jpeg',1n,1));
 ok(await blob.abort_upload(retried));
 console.log('Focused delayed callbacks passed: vault suspension, authority replacement, upload suspension; denied writes leave no pending row/reservation.');
 // Reuse actual private rows and the same observed-hold fixture for reads.
 vault.setPrincipal(governor); ok(await vault.set_club_domain_canister(delayed.canisterId));
 vault.setPrincipal(victim);
 ok(await vault.register_file('private-file','f','club',[],'Private file','https://example.invalid/private',1n,'text/plain',true,[],[],[]));
 assert.equal(ok(await vault.read_account_get_folder('f'))[0].id,'f');
 assert.equal(ok(await vault.read_account_get_file('private-file'))[0].id,'private-file');
 assert.equal(ok(await vault.read_account_list_club_files('club',[],[])).length,1);
 assert.deepEqual(ok(await vault.read_resource_club('folder','f')),['club']);
 const suspendHeldRead=async(factory,canisterId,method,args,hold=1n)=>{
  await delayed.actor.hold_on(hold);
  const pending=await deferred(factory,canisterId,method,args);
  await waitForHold(Number(hold));
  id.setPrincipal(governor); ok(await id.set_account_status(account.id,{Suspended:null}));
  await delayed.actor.release(); await denied(pending);
  ok(await id.set_account_status(account.id,{Active:null}));
 };
 for (const [method,args] of [
  ['read_account_get_folder',['f']], ['read_account_get_file',['private-file']],
  ['read_account_list_folders',['club',[],[]]], ['read_account_list_club_files',['club',[],[]]],
  ['read_resource_club',['folder','f']]
 ]) await suspendHeldRead(vaultIdl,services[2].canisterId,method,args);
 // A stale discovery reply must not disclose location after a setter change.
 await delayed.actor.hold_on(1n);
 const staleLocation=await deferred(vaultIdl,services[2].canisterId,'read_resource_club',['folder','f']);
 await waitForHold(1);
 vault.setPrincipal(governor); ok(await vault.set_club_domain_canister(extra[0].canisterId));
 await delayed.actor.release(); assert.deepEqual(ok(await staleLocation()),[]);
 ok(await vault.set_club_domain_canister(delayed.canisterId));
 // A permitting membership snapshot cannot cross a new resource fence.
 await delayed.actor.hold_on(1n);
 const fencedFiles=await deferred(vaultIdl,services[2].canisterId,'read_account_list_club_files',['club',[],[]]);
 await waitForHold(1); ok(await vault.set_transfer_fence('club',true));
 await delayed.actor.release(); assert.deepEqual(ok(await fencedFiles()),[]);
 ok(await vault.set_transfer_fence('club',false));
 vault.setPrincipal(victim); assert.equal(ok(await vault.read_account_list_club_files('club',[],[])).length,1);
 // Real encryption/decryption positive control: key tests cannot pass merely
 // because the transport key or local vetKD configuration is invalid.
 pii.setPrincipal(governor); ok(await pii.set_club_domain_canister(delayed.canisterId));
 const verification=DerivedPublicKey.deserialize(Uint8Array.from(await pii.pii_vetkey_verification_key()));
 const piiIdentity=new TextEncoder().encode('staff-private\u001fname');
 const plaintext=new TextEncoder().encode('Local permission acceptance');
 const cipher=IbeCiphertext.encrypt(verification,IbeIdentity.fromBytes(piiIdentity),plaintext,IbeSeed.random()).serialize();
 ok(await pii.register_pii('staff-private','name',[...cipher],governor));
 ok(await pii.grant_pii_read_club('staff-private','name','club'));
 const readKey=async()=>{
  pii.setPrincipal(victim); const transport=TransportSecretKey.random();
  const result=ok(await pii.get_encrypted_pii_vetkeys_batch(['staff-private'],'name',transport.publicKeyBytes()));
  assert.equal(result[0].length,1);
  const key=EncryptedVetKey.deserialize(Uint8Array.from(result[0][0])).decryptAndVerify(transport,verification,piiIdentity);
  assert.deepEqual(IbeCiphertext.deserialize(cipher).decrypt(key),plaintext);
 };
 await readKey();
 pii.setPrincipal(victim); assert.equal(ok(await pii.get_encrypted_pii_batch(['staff-private'],'name','read','control')).length,1);
 await suspendHeldRead(piiIdl,services[1].canisterId,'get_encrypted_pii_batch',[['staff-private'],'name','read','interrupted']);
 // Hold the SECOND staff lookup, which occurs only after real key derivation.
 await suspendHeldRead(piiIdl,services[1].canisterId,'get_encrypted_pii_vetkeys_batch',[['staff-private'],'name',TransportSecretKey.random().publicKeyBytes()],2n);
 await readKey();
 await delayed.actor.hold_on(2n);
 const fencedKey=await deferred(piiIdl,services[1].canisterId,'get_encrypted_pii_vetkeys_batch',[['staff-private'],'name',TransportSecretKey.random().publicKeyBytes()]);
 await waitForHold(2); pii.setPrincipal(governor); ok(await pii.set_transfer_fence('club',true));
 await delayed.actor.release(); await denied(fencedKey);
 ok(await pii.set_transfer_fence('club',false)); await readKey();
 // Compatibility with a REAL delegated service caller, not a registered
 // human pretending to be one: the vault asks club_domain for the human.
 club.setPrincipal(governor); ok(await club.create_club('club','Local club','local-club',[],[]));
 ok(await club.add_role_grant(victim,'club','player',[]));
 vault.setPrincipal(governor); ok(await vault.set_club_domain_canister(extra[0].canisterId));
 vault.setPrincipal(victim); assert.equal(ok(await vault.read_account_list_club_files('club',[],[])).length,1);
 await denied(()=>club.read_has_club_membership(victim,'club'));
 // Actual club-photo ciphertext round trip on TWO admission-enabled stores.
 // Cached plaintext/keys cannot be revoked; assertions request fresh keys.
 const secondBlobFixture=await pic.setupCanister({idlFactory:blobFactory,wasm:process.env.MEDIA_BLOB_STORE_WASM,sender:governor,controllers:[governor],
  environmentVariables:[...env,{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()},{name:'GOVERNOR_PRINCIPAL',value:governor.toText()}],arg:IDL.encode([IDL.Principal],[governor])});
 const secondBlob=secondBlobFixture.actor;
 id.setPrincipal(governor); ok(await id.set_service_authorities([...services,...extra,secondBlobFixture].map(s=>s.canisterId)));
 pii.setPrincipal(governor); ok(await pii.set_club_domain_canister(extra[0].canisterId));
 const photoIdentity=new TextEncoder().encode('clubmedia:club\u001fblob');
 const photoBytes=new TextEncoder().encode('Local encrypted photo bytes');
 const photoCipher=IbeCiphertext.encrypt(verification,IbeIdentity.fromBytes(photoIdentity),photoBytes,IbeSeed.random()).serialize();
 const photoPaths=[], pendingPhotos=[];
 for(const [n,store] of [blob,secondBlob].entries()) {
  store.setPrincipal(governor); ok(await store.set_club_domain_canister(extra[0].canisterId));
  ok(await club.register_media_quota_store(n===0?extra[7].canisterId:secondBlobFixture.canisterId));
  store.setPrincipal(victim);
  const path=`clubs/club/gallery/removal-${n}.jpg`;
  const upload=ok(await store.begin_upload(path,'image/jpeg',BigInt(photoCipher.length),1));
  ok(await store.put_chunk(upload,0,photoCipher)); ok(await store.finalize_upload(upload));
  const response=await store.http_request({url:`/${path}`,method:'GET',headers:[],body:new Uint8Array()});
  assert.equal(response.status_code,200); assert.deepEqual(Uint8Array.from(response.body),photoCipher);
  pii.setPrincipal(victim); const transport=TransportSecretKey.random();
  const encrypted=ok(await pii.get_club_media_vetkey('club',transport.publicKeyBytes()));
  const key=EncryptedVetKey.deserialize(Uint8Array.from(encrypted)).decryptAndVerify(transport,verification,photoIdentity);
  assert.deepEqual(IbeCiphertext.deserialize(Uint8Array.from(response.body)).decrypt(key),photoBytes);
  photoPaths.push(path);
  const pendingPath=`clubs/club/gallery/removal-pending-${n}.jpg`;
  const pending=ok(await store.begin_upload(pendingPath,'image/jpeg',BigInt(photoCipher.length),1));
  ok(await store.put_chunk(pending,0,photoCipher)); pendingPhotos.push(pending);
 }
 // Exercise the exact adapter used by dev-loopback app connectors with a
 // real actor; legacy private queries are closed under this rehearsal.
 const adaptedVault=adaptLocalAccountReads(vault,vaultIdl({IDL}),'http://localhost:4943');
 assert.equal(ok(await adaptedVault.get_folder('f'))[0].id,'f');
 assert.equal(ok(await adaptedVault.list_club_files('club',[],[])).length,1);
 id.setPrincipal(governor); ok(await id.set_account_status(account.id,{Suspended:null}));
 await denied(()=>adaptedVault.get_folder('f'));
 ok(await id.set_account_status(account.id,{Active:null}));
 // Denied/malformed prefix cannot indefinitely hide a valid tail recipient.
 queue.setPrincipal(governor); ok(await queue.enqueue('fair-tail',stranger.toText(),'club','event','tail','fair-tail'));
 const workerQueue=pic.createActor(createPushQueueIdl,services[3].canisterId);
 workerQueue.setPrincipal(governor);
 let tailClaimed=false;
 for(let round=0;round<8;round++) {
  const claimed=ok(await workerQueue.claim(99999999999999n,1));
  for(const item of claimed) {
   if(item.id==='fair-tail') tailClaimed=true;
   assert.equal(ok(await workerQueue.acknowledge(item.id,notificationKey(item))).status.Delivered,null);
  }
  if(tailClaimed) break;
 }
 assert.ok(tailClaimed,'Eligible tail must be reached despite malformed prefix');
 assert.equal(ok(await workerQueue.list_device_tokens([victim.toText()])).length,1,'Worker contract must use consensus token reads');
 console.log('Focused protected reads passed: five suspended vault read/discovery paths, stale discovery authority, fenced file batch, interrupted PII ciphertext, post-derivation suspension/fence, real-key decrypt controls and real vault-to-club delegation.');
 id.setPrincipal(governor); ok(await id.set_account_status(account.id,{Suspended:null}));
 chat.setPrincipal(victim);
 for (const actor of [club,events,competition,league,points,media,insights,blob]) actor.setPrincipal(victim);
 const domainCalls=[
  ()=>club.read_account_my_role_grants(), ()=>events.read_account_list_my_viewed_event_ids([]),
  ()=>competition.create_competition('club','Denied','2026'), ()=>league.read_account_get_mini_league(mini.id),
  ()=>points.read_account_get_user_points('club',victim.toText()), ()=>media.read_account_get_asset(asset.id),
  ()=>insights.record_web_vital('LCP',12,'good','/denied'), ()=>blob.begin_upload('clubs/club/denied.jpg','image/jpeg',1n,1),
  ()=>queue.enqueue('denied-write',victim.toText(),'club','event','denied','denied')
 ];
 queue.setPrincipal(victim);
 for (const call of domainCalls) await denied(call);
 await denied(()=>chat.read_account_list_messages_page(conversation.id,[],10));
 ok(await id.set_account_status(account.id,{Active:null}));
 assert.equal(ok(await chat.read_account_list_messages_page(conversation.id,[],10)).messages.length,1);
 // Erase while a REAL derived club key awaits its second membership reply.
 pii.setPrincipal(governor); ok(await pii.set_club_domain_canister(delayed.canisterId));
 await delayed.actor.hold_on(2n);
 const erasedPhotoKey=await deferred(piiIdl,services[1].canisterId,'get_club_media_vetkey',['club',TransportSecretKey.random().publicKeyBytes()]);
 await waitForHold(2);
 const receiverRequest={account_id:account.id,generation:7n,inventory_digest:new Uint8Array(32).fill(7),subjects:[victim]};
 // Test the receiver independently while an actual derived-key callback is held.
 // The registry fixture separately tests real coordinator -> receiver transport.
 pii.setPrincipal(identity.canisterId);
 ok(await pii.prepare_account_removal(receiverRequest));
 const heldDrain=ok(await pii.read_account_removal_drain(receiverRequest));
 assert.ok(heldDrain.outstanding>0n,'Held key request must prevent a drained receipt');
 ok(await pii.prepare_account_removal(receiverRequest));
 assert.ok('Err' in await pii.prepare_account_removal({...receiverRequest,generation:8n}));
 queue.setPrincipal(governor);
 ok(await queue.enqueue('held-delivery',victim.toText(),'app','event','Held worker delivery','held-delivery-key'));
 const heldDelivery=ok(await queue.claim(99999999999999n,100)).find(n=>n.id==='held-delivery');
 assert.ok(heldDelivery,'Positive worker lease must exist before fencing');
 queue.setPrincipal(victim);
 assert.ok('Err' in await queue.delete_notification('held-delivery'));
 assert.ok('Err' in await queue.clear_inbox(victim.toText(),[]));
 for (const receiver of [club,vault,events,competition,league,points,media,insights,queue,chat]) {
  receiver.setPrincipal(identity.canisterId);
  ok(await receiver.prepare_account_removal(receiverRequest));
  assert.equal(ok(await receiver.read_account_removal_drain(receiverRequest)).outstanding,receiver===queue?1n:0n);
 }
 queue.setPrincipal(governor);
 assert.equal(ok(await queue.recover()),0,'Recovery must not reset an issued external capability');
 assert.deepEqual(await queue.authorize_delivery('held-delivery','held-delivery-key'),{Ok:false});
 await pic.upgradeCanister({canisterId:services[3].canisterId,wasm:process.env.NOTIFICATION_QUEUE_WASM,sender:governor,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]},arg:IDL.encode([IDL.Principal],[governor])});
 queue.setPrincipal(identity.canisterId);
 assert.equal(ok(await queue.read_account_removal_drain(receiverRequest)).outstanding,1n,'Unsettled external delivery must survive upgrade');
 queue.setPrincipal(stranger); await denied(()=>queue.acknowledge('held-delivery','held-delivery-key'));
 queue.setPrincipal(governor); ok(await queue.acknowledge('held-delivery','held-delivery-key'));
 queue.setPrincipal(identity.canisterId);
 assert.equal(ok(await queue.read_account_removal_drain(receiverRequest)).outstanding,0n,'Only authenticated lease settlement releases delivery drain');
 // Existing local roles remain: denial must come from the durable human fence.
 vault.setPrincipal(victim); await denied(()=>vault.read_account_list_club_files('club',[],[]));
 club.setPrincipal(extra[0].canisterId); await denied(()=>club.read_has_club_staff_role(victim,'club'));
 id.setPrincipal(victim); ok(await id.erase_account(account.id));
 await delayed.actor.release(); await denied(erasedPhotoKey);
 pii.setPrincipal(identity.canisterId);
 assert.equal(ok(await pii.read_account_removal_drain(receiverRequest)).outstanding,0n,'Settled denied key must release its tracked hold');
 await pic.upgradeCanister({canisterId:services[1].canisterId,wasm:process.env.PII_ACCESS_CONTROL_WASM,sender:governor,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]},arg:IDL.encode([IDL.Principal],[governor])});
 assert.equal(ok(await pii.read_account_removal_drain(receiverRequest)).outstanding,0n);
 pii.setPrincipal(governor); assert.ok('err' in await pii.rekey_principal(victim,stranger,false));
 for (const [receiver,canisterId,wasm] of [[club,extra[0].canisterId,process.env.CLUB_DOMAIN_WASM],[vault,services[2].canisterId,process.env.VAULT_DOMAIN_WASM],
  ...extra.slice(1,7).map(s=>[s.actor,s.canisterId,process.env[s.name.toUpperCase()+'_WASM']]),
  [queue,services[3].canisterId,process.env.NOTIFICATION_QUEUE_WASM], [chat,services[0].canisterId,process.env.MESSAGING_DOMAIN_WASM]]) {
  await pic.upgradeCanister({canisterId,wasm,sender:governor,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]},arg:IDL.encode([IDL.Principal],[governor])});
  receiver.setPrincipal(identity.canisterId);
  assert.equal(ok(await receiver.read_account_removal_drain(receiverRequest)).outstanding,0n);
  receiver.setPrincipal(governor);
  assert.ok('err' in await receiver.rekey_principal(victim,stranger,false));
 }
 club.setPrincipal(victim);
 pii.setPrincipal(governor); ok(await pii.set_club_domain_canister(extra[0].canisterId));
 pii.setPrincipal(victim); await denied(()=>pii.get_club_media_vetkey('club',TransportSecretKey.random().publicKeyBytes()));
 vault.setPrincipal(victim); await denied(()=>vault.read_account_list_club_files('club',[],[]));
 for(const [n,store] of [blob,secondBlob].entries()) {
  store.setPrincipal(victim);
  await denied(()=>store.begin_upload(`clubs/club/gallery/after-erasure-${n}.jpg`,'image/jpeg',1n,1));
  await denied(()=>store.put_chunk(pendingPhotos[n],0,photoCipher));
  await denied(()=>store.finalize_upload(pendingPhotos[n]));
  const pendingResponse=await store.http_request({url:`/clubs/club/gallery/removal-pending-${n}.jpg`,method:'GET',headers:[],body:new Uint8Array()});
  assert.equal(pendingResponse.status_code,404,'Denied finalize must not publish ciphertext');
  const retained=await store.http_request({url:`/${photoPaths[n]}`,method:'GET',headers:[],body:new Uint8Array()});
  assert.deepEqual(Uint8Array.from(retained.body),photoCipher,'Public endpoint remains ciphertext, never plaintext');
 }
 console.log('PASS: real two-store ciphertext upload/read/decrypt, erase during post-derivation membership callback, fresh club-photo key denial, denied upload/chunk/finalize with no publication, and real vault-to-club original-human denial. Cached keys/previous downloads are not revoked.');
 for (const actor of [club,events,competition,league,points,media,insights,blob,queue,chat]) actor.setPrincipal(victim);
 for (const call of domainCalls) await denied(call);
 await denied(()=>chat.read_account_list_messages_page(conversation.id,[],10));
 await denied(()=>chat.send_message(conversation.id,'must fail','m2',[],[]));
 await denied(()=>pii.get_encrypted_pii_batch(['private'],'name','read','local'));
 await denied(()=>pii.get_encrypted_pii_vetkeys_batch(['private'],'name',new Uint8Array([1])));
 await denied(()=>vault.rename_file('missing','denied before lookup'));
 await denied(()=>vault.read_account_list_folders('club',[],[]));
 queue.setPrincipal(victim); await denied(()=>queue.list_inbox(victim.toText(),[],10));
 queue.setPrincipal(governor); assert.equal(ok(await queue.claim(99999999999999n,10)).length,0);
 assert.equal(ok(await queue.list_device_tokens([victim.toText()])).length,0);
 await pic.stopCanister({canisterId:identity.canisterId,sender:governor});
 for (const actor of [club,events,competition,league,points,media,insights,blob,queue]) actor.setPrincipal(stranger);
 for (const call of domainCalls) await denied(call);
 chat.setPrincipal(stranger); await denied(()=>chat.read_account_my_unread_counts());
 pii.setPrincipal(stranger); await denied(()=>pii.get_encrypted_pii_batch(['private'],'name','read','outage'));
 vault.setPrincipal(stranger); await denied(()=>vault.read_account_list_folders('club',[],[]));
 queue.setPrincipal(stranger); await denied(()=>queue.list_inbox(stranger.toText(),[],10));
 await pic.startCanister({canisterId:identity.canisterId,sender:governor});
 // Stable reader inventory survives an upgrade; removal cannot be bypassed.
 await pic.upgradeCanister({canisterId:identity.canisterId,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
 chat.setPrincipal(victim); await denied(()=>chat.read_account_list_messages_page(conversation.id,[],10));
 id.setPrincipal(stranger); const kept=ok(await id.whoami());
 id.setPrincipal(governor); ok(await id.rekey_principal(stranger,p(4),false));
 chat.setPrincipal(stranger); await denied(()=>chat.read_account_my_unread_counts());
 pii.setPrincipal(stranger); await denied(()=>pii.get_encrypted_pii_batch(['private'],'name','read','rekey'));
 vault.setPrincipal(stranger); await denied(()=>vault.read_account_list_folders('club',[],[]));
 queue.setPrincipal(stranger); await denied(()=>queue.list_inbox(stranger.toText(),[],10));
 chat.setPrincipal(p(4)); assert.deepEqual(await chat.read_account_my_unread_counts(),[]);
 id.setPrincipal(p(4)); assert.equal(ok(await id.whoami()).id,kept.id);
 console.log('Twelve local services passed: real competition/league/media/points rows (7 points), suspended/erased subjects, stranger digest, outage; no production/global revocation claim. Prior four-service checks: real private rows, erased subject, worker recipients, outage and identity upgrade. No production/global revocation claim.');
} finally { if(pic) await pic.tearDown(); await server.stop(); }
