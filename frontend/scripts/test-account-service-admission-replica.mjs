// Local-only service rehearsal, never production wiring or activation.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
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
 pic = await PocketIc.create(server.getUrl());
 const identity = await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,controllers:[governor],environmentVariables:env,arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
 const services=[];
 for (const [name,idlFactory] of [['messaging_domain',chatIdl],['pii_access_control',piiIdl],['vault_domain',vaultIdl],['notification_queue',queueIdl]]) {
  services.push(await pic.setupCanister({idlFactory,wasm:process.env[name.toUpperCase()+'_WASM'],sender:governor,controllers:[governor],environmentVariables:[...env,{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()}],arg:IDL.encode([IDL.Principal],[governor])}));
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
 await denied(()=>league.read_account_verify_child_guardian(victim,'unknown').then(r=>r===false?{Err:'self only'}:{Ok:r}));
 chat.setPrincipal(governor); const conversation=ok(await chat.create_conversation('club',[],[victim,governor]));
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
 id.setPrincipal(governor); ok(await id.set_account_status(account.id,{Suspended:null}));
 for (const actor of [club,events,competition,league,points,media,insights,blob]) actor.setPrincipal(victim);
 const domainCalls=[
  ()=>club.read_account_my_role_grants(), ()=>events.read_account_list_my_viewed_event_ids([]),
  ()=>competition.create_competition('club','Denied','2026'), ()=>league.read_account_get_mini_league(mini.id),
  ()=>points.read_account_get_user_points('club',victim.toText()), ()=>media.read_account_get_asset(asset.id),
  ()=>insights.record_web_vital('LCP',12,'good','/denied'), ()=>blob.begin_upload('clubs/club/denied.jpg','image/jpeg','sum',1n,99999999999999n),
  ()=>queue.enqueue('denied-write',victim.toText(),'club','event','denied','denied')
 ];
 queue.setPrincipal(victim);
 for (const call of domainCalls) await denied(call);
 await denied(()=>chat.read_account_list_messages_page(conversation.id,[],10));
 ok(await id.set_account_status(account.id,{Active:null}));
 assert.equal(ok(await chat.read_account_list_messages_page(conversation.id,[],10)).messages.length,1);
 id.setPrincipal(victim); ok(await id.erase_account(account.id));
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
