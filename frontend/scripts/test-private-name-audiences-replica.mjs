// Disposable local consensus + real SDK crypto. Never reads live deployments.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as competitionIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as leagueIdl } from '../src/lab/bindings/mini_league_domain/declarations/mini_league_domain.did.js';
import { idlFactory as messagingIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
const root=resolve(import.meta.dirname,'../..');
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=p(1),viewer=p(2),owner=p(3),outsider=p(4);
const ok=r=>{assert.ok('Ok' in r,r.Err);return r.Ok;};
const arg=IDL.encode([IDL.Principal],[governor]);
const identityArg=IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}]);
const privacy={name:'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL',value:'1'};
const names=['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
const wasm=d=>resolve(root,`backend/${d}/.mops/.build/${d}.wasm`);
const server=await PocketIcServer.start();let pic;
try {
  pic=await PocketIc.create(server.getUrl(),{fiduciary:{state:{type:'new'}}});
  const identity=await pic.setupCanister({idlFactory:identityIdl,wasm:resolve(root,'target/wasm32-unknown-unknown/release/identity_access.wasm'),sender:governor,controllers:[governor],arg:identityArg,environmentVariables:[{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'},{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]});
  const router=await pic.setupCanister({idlFactory:routerIdl,wasm:resolve(root,'target/wasm32-unknown-unknown/release/shard_router.wasm'),sender:governor,controllers:[governor],arg:identityArg,environmentVariables:[{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'},{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]});
  const groups=[];
  for(let n=0;n<2;n++) {
    const club=await pic.setupCanister({idlFactory:clubIdl,wasm:wasm('club_domain'),sender:governor,controllers:[governor],arg,environmentVariables:[privacy,{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]});
    club.actor.setPrincipal(governor);ok(await club.actor.set_identity_access_canister(identity.canisterId));
    await pic.updateCanisterSettings({canisterId:club.canisterId,sender:governor,environmentVariables:[privacy]});
    await pic.upgradeCanister({canisterId:club.canisterId,wasm:wasm('club_domain'),sender:governor,arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    const env=[privacy,{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()}];
    const competition=await pic.setupCanister({idlFactory:competitionIdl,wasm:wasm('competition_domain'),sender:governor,controllers:[governor],arg,environmentVariables:env});
    const league=await pic.setupCanister({idlFactory:leagueIdl,wasm:wasm('mini_league_domain'),sender:governor,controllers:[governor],arg,environmentVariables:env});
    const messaging=await pic.setupCanister({idlFactory:messagingIdl,wasm:wasm('messaging_domain'),sender:governor,controllers:[governor],arg,environmentVariables:env});
    let directRelay;
    if(n===1 && process.env.PRIVATE_DIRECT_NAME_RELAY_WASM) {
      const method=messagingIdl({IDL})._fields.find(([name])=>name==='read_profile_direct_batch')?.[1];assert.ok(method);
      const relayIdl=({IDL})=>IDL.Service({read_profile_direct_batch:method,
        hold_on:IDL.Func([IDL.Nat],[],[]),release:IDL.Func([],[],[]),progress:IDL.Func([],[IDL.Nat,IDL.Nat,IDL.Bool],['query'])});
      directRelay=await pic.setupCanister({idlFactory:relayIdl,wasm:process.env.PRIVATE_DIRECT_NAME_RELAY_WASM,sender:governor,controllers:[governor],
        arg:IDL.encode([IDL.Principal,IDL.Principal,IDL.Principal],[governor,messaging.canisterId,identity.canisterId])});
      await pic.updateCanisterSettings({canisterId:messaging.canisterId,sender:governor,environmentVariables:[privacy,{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:directRelay.canisterId.toText()}]});
      await pic.upgradeCanister({canisterId:messaging.canisterId,wasm:wasm('messaging_domain'),sender:governor,arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    }
    const pii=await pic.setupCanister({idlFactory:piiIdl,wasm:wasm('pii_access_control'),sender:governor,controllers:[governor],arg,environmentVariables:[privacy,{name:'IGNITE_PRIVATE_PROFILE_IDENTITY',value:identity.canisterId.toText()},{name:'VETKD_KEY_NAME',value:'key_1'}]});
    club.actor.setPrincipal(governor);ok(await club.actor.create_club(`club-${n}`,'Privacy club','privacy',[],[]));
    ok(await club.actor.replace_acl(1n,{clubs:[`club-${n}`],teams:[],children:[{id:`child-${n}`,parent:[viewer],club_id:[`club-${n}`],teams:[]}],guardians:[{child:`child-${n}`,user:owner}],exclusions:[],roles:[viewer,owner].map(user=>({user,role:'member',club:[`club-${n}`],team:[]}))}));
    groups.push({club,competition,league,messaging,pii,directRelay});
  }
  const accounts=new Map();
  for(const user of [viewer,owner,outsider]){identity.actor.setPrincipal(user);accounts.set(user.toText(),ok(await identity.actor.register_account()).id);}
  const original=groups[0].pii;
  const reference=`pii-display-name:v1:${original.canisterId.toText()}:${owner.toText()}`;
  identity.actor.setPrincipal(owner);ok(await identity.actor.set_profile(reference,[]));
  identity.actor.setPrincipal(viewer);ok(await identity.actor.set_profile('Guardian',[]));
  identity.actor.setPrincipal(outsider);ok(await identity.actor.set_profile('Outsider',[]));
  const subnet=await pic.getCanisterSubnetId(identity.canisterId);assert.ok(subnet);
  router.actor.setPrincipal(governor);let revision=await router.actor.version();
  for(let n=0;n<2;n++){
    const g=groups[n];const domains=names.map((domain,index)=>({domain,canister:domain==='club_domain'?g.club.canisterId:domain==='pii_access_control'?g.pii.canisterId:domain==='competition_domain'?g.competition.canisterId:domain==='mini_league_domain'?g.league.canisterId:domain==='messaging_domain'?(g.directRelay?.canisterId??g.messaging.canisterId):domain==='secret_workload_identity'?p(90):p(10+n*30+index)}));
    const group={id:`g${n+1}`,target_alias:'mainnet',domains,photo_store:[],accepting:false,max_clubs:100,assigned_clubs:0,heap_budget_bytes:1_000_000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n};
    revision=ok(await router.actor.register_group(group,revision));
    revision=ok(await router.actor.register_group_placement({group_id:group.id,deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:domains.map(d=>({...d,subnet}))},revision));
  }
  const binding={registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'};
  identity.actor.setPrincipal(governor);ok(await identity.actor.pin_owner_test_deletion_registry(binding));
  ok(await identity.actor.set_service_authorities(groups.map(g=>g.pii.canisterId)));
  const sources=groups.map(g=>g.club.canisterId);
  ok(await identity.actor.configure_membership_directory(binding,sources,1n));
  const encoding=new TextEncoder();const input=encoding.encode(`${owner.toText()}\u001fdisplay_name`);
  original.actor.setPrincipal(owner);const verification=DerivedPublicKey.deserialize(Uint8Array.from(await original.actor.pii_vetkey_verification_key()));
  const encrypted=IbeCiphertext.encrypt(verification,IbeIdentity.fromBytes(input),encoding.encode('Paul Cranwell'),IbeSeed.random()).serialize();
  ok(await original.actor.register_pii(owner.toText(),'display_name',encrypted,owner));
  const scope=(kind,authority,resource,profile_revision=0n)=>({kind,authority,resource,profile_revision});
  const read=async(user,audience)=>{original.actor.setPrincipal(user);return original.actor.get_private_profile_names_batch([owner.toText()],audience);};
  const decrypt=async(user,audience)=>{
    const rows=ok(await read(user,audience));assert.equal(rows.length,1);
    original.actor.setPrincipal(user);const transport=TransportSecretKey.random();
    const keys=ok(await original.actor.get_private_profile_name_vetkeys_batch([owner.toText()],audience,transport.publicKeyBytes()));
    const key=EncryptedVetKey.deserialize(Uint8Array.from(keys[0][0])).decryptAndVerify(transport,verification,input);
    assert.equal(new TextDecoder().decode(IbeCiphertext.deserialize(Uint8Array.from(rows[0].ciphertext)).decrypt(key)),'Paul Cranwell');
  };
  await decrypt(viewer,scope('club',groups[1].club.canisterId,'club-1'));
  await decrypt(viewer,scope('family',groups[1].club.canisterId,'child-1'));
  const broadcastService=groups[0].messaging;
  broadcastService.actor.setPrincipal(governor);ok(await broadcastService.actor.ensure_broadcast_conversation());
  const announcement=ok(await broadcastService.actor.send_message('broadcast','Announcement','private-broadcast-test',[],[]));
  const broadcast=scope('broadcast',broadcastService.canisterId,announcement.id);
  assert.ok('Err' in await read(viewer,broadcast),'Unrelated signed-in profile cannot become global search via broadcast');
  broadcastService.actor.setPrincipal(owner);ok(await broadcastService.actor.toggle_reaction(announcement.id,'like'));
  await decrypt(viewer,broadcast);
  broadcastService.actor.setPrincipal(identity.canisterId);
  const reacted=ok(await broadcastService.actor.read_profile_broadcast_batch(viewer,announcement.id,[owner],[]));
  broadcastService.actor.setPrincipal(owner);ok(await broadcastService.actor.toggle_reaction(announcement.id,'like'));
  assert.ok('Err' in await read(viewer,broadcast),'Removing the final reaction removes the personal-name audience');
  ok(await broadcastService.actor.mark_read('broadcast',announcement.id));await decrypt(viewer,broadcast);
  broadcastService.actor.setPrincipal(identity.canisterId);
  assert.ok('Err' in await broadcastService.actor.read_profile_broadcast_batch(viewer,announcement.id,[owner],[reacted.revision]),'Reaction/read ABA invalidates retained audience');
  broadcastService.actor.setPrincipal(governor);
  const secondAnnouncement=ok(await broadcastService.actor.send_message('broadcast','Another announcement','private-broadcast-second',[],[]));
  assert.ok('Err' in await read(viewer,scope('broadcast',broadcastService.canisterId,secondAnnouncement.id)),'A reader of one announcement is not a reader/reactor of another');
  broadcastService.actor.setPrincipal(owner);ok(await broadcastService.actor.mark_read('broadcast',secondAnnouncement.id));
  assert.ok('Err' in await read(viewer,broadcast),'A newer receipt cannot be used as old-message private-name evidence');
  ok(await broadcastService.actor.mark_read('broadcast',announcement.id));await decrypt(viewer,broadcast);
  broadcastService.actor.setPrincipal(viewer);ok(await broadcastService.actor.block_user(owner));
  assert.ok('Err' in await read(viewer,broadcast),'Blocked broadcast participant supplies no fresh name keys');
  ok(await broadcastService.actor.unblock_user(owner));await decrypt(viewer,broadcast);
  assert.ok('Err' in await read(viewer,scope('broadcast',broadcastService.canisterId,'fake')),'Only canonical broadcast scope is allowed');
  console.log('PASS: real broadcast participant SDK names require their recorded reaction/read; unrelated profiles, removed reactions, blocks, stale revisions and forged scopes denied. Fixed Announcements author label remains unchanged.');
  const dm=groups[1].messaging;dm.actor.setPrincipal(viewer);
  const directConversation=ok(await dm.actor.create_conversation('dm',[],[viewer,owner]));
  const directAuthority=groups[1].directRelay?.canisterId??dm.canisterId;
  const direct=scope('direct',directAuthority,directConversation.id);
  assert.ok('Err' in await read(viewer,direct),'A caller-created DM cannot enumerate an arbitrary peer name');
  dm.actor.setPrincipal(owner);ok(await dm.actor.send_message(directConversation.id,'Hello','privacy-peer-consent',[],[]));
  await decrypt(viewer,direct);
  assert.ok('Err' in await read(outsider,direct),'Unrelated user cannot decrypt direct names');
  dm.actor.setPrincipal(outsider);
  assert.ok('Err' in await dm.actor.read_profile_direct_batch(viewer,directConversation.id,[owner],[]),'Browser cannot impersonate identity service');
  dm.actor.setPrincipal(viewer);ok(await dm.actor.block_user(owner));
  assert.ok('Err' in await read(viewer,direct),'Blocked participant cannot obtain fresh direct keys');
  ok(await dm.actor.unblock_user(owner));await decrypt(viewer,direct);
  dm.actor.setPrincipal(directAuthority===dm.canisterId?identity.canisterId:directAuthority);
  const retained=ok(await dm.actor.read_profile_direct_batch(viewer,directConversation.id,[owner],[]));
  dm.actor.setPrincipal(viewer);ok(await dm.actor.block_user(owner));ok(await dm.actor.unblock_user(owner));
  dm.actor.setPrincipal(directAuthority===dm.canisterId?identity.canisterId:directAuthority);
  assert.ok('Err' in await dm.actor.read_profile_direct_batch(viewer,directConversation.id,[owner],[retained.revision]),'Block/unblock ABA invalidates retained direct authorization');
  await decrypt(viewer,direct);
  if(groups[1].directRelay) {
    const relay=groups[1].directRelay;
    const signature=piiIdl({IDL})._fields.find(([method])=>method==='get_private_profile_name_vetkeys_batch')?.[1];assert.ok(signature);
    const hold=async(at)=>{
      relay.actor.setPrincipal(governor);await relay.actor.hold_on(BigInt(at));
      const pending=await pic.client.submitCall({canisterId:original.canisterId,sender:viewer,method:'get_private_profile_name_vetkeys_batch',
        payload:new Uint8Array(IDL.encode(signature.argTypes,[[owner.toText()],direct,TransportSecretKey.random().publicKeyBytes()]))});
      let observed=false;
      for(let step=0;step<100;step++){await pic.tick(1);const progress=await relay.actor.progress();if(progress[1]===BigInt(at)&&!progress[2]){observed=true;break;}}
      assert.ok(observed,`Real messaging private-name authorization reply ${at} must be held`);
      return async()=>{await relay.actor.release();return IDL.decode(signature.retTypes,(await pic.client.awaitCall(pending)).body)[0];};
    };
    for(const at of [1,2,3,4]) {
      for(const subject of [viewer,owner]) {
        const finish=await hold(at);
        identity.actor.setPrincipal(governor);ok(await identity.actor.set_account_status(accounts.get(subject.toText()),{Suspended:null}));
        assert.ok('Err' in await finish(),`Suspended ${subject===viewer?'viewer':'subject'} at reply ${at} receives no derived key`);
        ok(await identity.actor.set_account_status(accounts.get(subject.toText()),{Active:null}));
        await decrypt(viewer,direct);
      }
      const finishProfile=await hold(at);
      identity.actor.setPrincipal(owner);ok(await identity.actor.set_profile('Changed private binding',[]));
      assert.ok('Err' in await finishProfile(),`Changed original profile binding at reply ${at} withholds derived keys`);
      ok(await identity.actor.set_profile(reference,[]));await decrypt(viewer,direct);
    }
    // Remote blocks are checked again after an opening service reply; this
    // does not certify revocation after the final remote decision is retained.
    for(const at of [1,3]) {
      const finish=await hold(at);dm.actor.setPrincipal(viewer);ok(await dm.actor.block_user(owner));
      assert.ok('Err' in await finish(),`Remote block after opening reply ${at} invalidates retained revision`);
      ok(await dm.actor.unblock_user(owner));await decrypt(viewer,direct);
    }
    console.log('PASS: all four real messaging replies held during original-PII key derivation; viewer/subject suspension and original-reference drift suppress final keys, opening-reply blocks invalidate retained revisions; each restored exact DM decrypts with SDK. Final remote-block delivery fencing remains unverified.');
  } else console.log('SKIPPED: held direct-name reply checks; set PRIVATE_DIRECT_NAME_RELAY_WASM to run observed interruptions.');
  assert.ok('Err' in await read(viewer,scope('direct',dm.canisterId,'broadcast')),'Broadcast is never a two-person direct audience');
  identity.actor.setPrincipal(viewer);const page=ok(await identity.actor.read_guardian_profile_candidates(groups[1].club.canisterId,'child-1',[]));
  const guardian=scope('guardian_search',groups[1].club.canisterId,'child-1',page.revision);
  await decrypt(viewer,guardian);
  assert.ok('Err' in await read(outsider,guardian));assert.ok('Err' in await read(viewer,scope('family',groups[1].club.canisterId,'foreign-child')));
  assert.ok('Err' in await read(viewer,scope('club',p(70),'club-1')));
  original.actor.setPrincipal(viewer);assert.equal(ok(await original.actor.get_encrypted_pii_batch([owner.toText()],'contact_email','read','isolation')).length,0);
  const comp=groups[1].competition;comp.actor.setPrincipal(governor);
  ok(await comp.actor.set_club_domain_canister(groups[1].club.canisterId));
  groups[1].club.actor.setPrincipal(governor);ok(await groups[1].club.actor.set_competition_authorities([comp.canisterId]));
  const competition=ok(await comp.actor.create_competition('club-1','Competition','2026'));
  ok(await comp.actor.grant_role(viewer,'committee',competition.id,[]));ok(await comp.actor.grant_role(owner,'committee',competition.id,[]));
  await decrypt(viewer,scope('competition',comp.canisterId,competition.id));
  // Use G1 messaging without the disposable DM relay: the original G1 PII
  // decrypts an admin relationship owned by G2 competition through exact
  // stored messaging bindings, never conversation-ID parsing.
  const adminMessaging=groups[0].messaging;
  await pic.updateCanisterSettings({canisterId:comp.canisterId,sender:governor,environmentVariables:[privacy,{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()},{name:'IGNITE_PRIVATE_PROFILE_MESSAGING',value:adminMessaging.canisterId.toText()}]});
  await pic.upgradeCanister({canisterId:comp.canisterId,wasm:wasm('competition_domain'),sender:governor,arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  comp.actor.setPrincipal(governor);ok(await comp.actor.grant_role(owner,'competition_admin',competition.id,[]));
  adminMessaging.actor.setPrincipal(governor);ok(await adminMessaging.actor.set_competition_domain_canister(comp.canisterId));
  adminMessaging.actor.setPrincipal(viewer);const adminThread=ok(await adminMessaging.actor.ensure_competition_admin_thread(competition.id,viewer));
  const adminScope=scope('competition_admin',adminMessaging.canisterId,adminThread.id);
  await decrypt(viewer,adminScope);
  assert.ok('Err' in await read(outsider,adminScope),'Unrelated competition audience cannot read a private admin thread');
  assert.ok('Err' in await read(viewer,scope('competition_admin',adminMessaging.canisterId,`competition-admin-${competition.id}-${owner.toText()}`)),'Guessed admin thread ID has no verified mapping');
  adminMessaging.actor.setPrincipal(identity.canisterId);
  const retainedAdmin=ok(await adminMessaging.actor.read_profile_competition_admin_batch(viewer,adminThread.id,[owner],[]));
  comp.actor.setPrincipal(governor);ok(await comp.actor.remove_competition_role(competition.id,owner,'competition_admin',[]));
  assert.ok('Err' in await read(viewer,adminScope),'Removed admin remains in cached chat participants but cannot disclose a name');
  ok(await comp.actor.grant_role(owner,'competition_admin',competition.id,[]));
  await decrypt(viewer,adminScope);
  adminMessaging.actor.setPrincipal(viewer);ok(await adminMessaging.actor.block_user(owner));
  assert.ok('Err' in await read(viewer,adminScope),'Blocked admin name cannot disclose fresh keys');
  ok(await adminMessaging.actor.unblock_user(owner));
  adminMessaging.actor.setPrincipal(identity.canisterId);
  assert.ok('Err' in await adminMessaging.actor.read_profile_competition_admin_batch(viewer,adminThread.id,[owner],[retainedAdmin.revision]),'Block ABA invalidates admin thread retained revision');
  await decrypt(viewer,adminScope);
  await pic.upgradeCanister({canisterId:adminMessaging.canisterId,wasm:wasm('messaging_domain'),sender:governor,arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  await decrypt(viewer,adminScope);
  console.log('PASS: real exact mapped admin thread SDK decryption; guessed threads, outsiders, stale removed admins, blocks and ABA refused; mapping and original-key decryption survive messaging upgrade. No live changes.');
  ok(await comp.actor.update_competition_settings(competition.id,'Competition',[],'open','public',3,1,0));
  assert.ok('Err' in await read(outsider,scope('competition',comp.canisterId,competition.id)),'Public competition never authorizes private names');
  comp.actor.setPrincipal(governor);ok(await comp.actor.grant_role(outsider,'club_admin','club-1',[]));
  assert.ok('Err' in await read(outsider,scope('competition',comp.canisterId,competition.id)),'Stale mirrored club-admin role cannot authorize names');
  const league=groups[1].league;league.actor.setPrincipal(governor);const l=ok(await league.actor.create_mini_league('club-1','League',[],[],5,3,20,[],true));
  ok(await league.actor.add_admin(l.id,viewer));ok(await league.actor.add_admin(l.id,owner));
  await decrypt(viewer,scope('league',league.canisterId,l.id));
  ok(await league.actor.remove_admin(l.id,owner));assert.ok('Err' in await read(viewer,scope('league',league.canisterId,l.id)),'Removed subject receives no key audience');
  const remoteClub=groups[1].club;remoteClub.actor.setPrincipal(governor);ok(await remoteClub.actor.set_mini_league_domain_canister(league.canisterId));
  remoteClub.actor.setPrincipal(league.canisterId);const remote=ok(await remoteClub.actor.read_profile_remote_revision([viewer,owner],[]));
  remoteClub.actor.setPrincipal(governor);ok(await remoteClub.actor.replace_acl(1n,{clubs:['club-1'],teams:[],children:[],guardians:[],exclusions:[],roles:[{user:owner,role:'member',club:['club-1'],team:[]}]}));
  remoteClub.actor.setPrincipal(league.canisterId);assert.ok('Err' in await remoteClub.actor.read_profile_remote_revision([viewer,owner],[remote]),'Removal invalidates retained remote authorization generation');
  assert.ok('Err' in await read(viewer,guardian),'Guardian removal withholds fresh keys');
  identity.actor.setPrincipal(governor);ok(await identity.actor.set_account_status(accounts.get(owner.toText()),{Suspended:null}));
  assert.ok('Err' in await read(viewer,scope('club',groups[1].club.canisterId,'club-1')));
  console.log('PASS: real cross-group original-PII SDK decryption for club, family, guardian, competition, league and direct; caller-created peer enumeration, unrelated user, service impersonation, blocked peer, block/unblock ABA and broadcast refusal; healthy direct retries. No live data or grants changed.');
} finally {await pic?.tearDown();await server.stop();}