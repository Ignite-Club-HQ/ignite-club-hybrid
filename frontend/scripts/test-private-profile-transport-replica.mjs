// Full local identity -> real club transport, no production hosts or keys.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
const root=resolve(import.meta.dirname,'../..');
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=p(1), requester=p(2), member=p(3), stranger=p(4), foreign=p(5);
const ok=r=>{assert.ok('Ok'in r,r.Err);return r.Ok;};
const privacy=[{name:'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL',value:'1'}];
const init=IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}]);
const clubArg=IDL.encode([IDL.Principal],[governor]);
const clubWasm=resolve(root,'backend/club_domain/.mops/.build/club_domain.wasm');
const identityWasm=resolve(root,'target/wasm32-unknown-unknown/release/identity_access.wasm');
const names=['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
const server=await PocketIcServer.start();let pic;
try {
  pic=await PocketIc.create(server.getUrl());
  const router=await pic.setupCanister({idlFactory:routerIdl,wasm:resolve(root,'target/wasm32-unknown-unknown/release/shard_router.wasm'),sender:governor,controllers:[governor],arg:init});
  const identity=await pic.setupCanister({idlFactory:identityIdl,wasm:identityWasm,sender:governor,controllers:[governor],arg:init,environmentVariables:[{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'}]});
  const i=identity.actor;
  const accounts=new Map();
  for(const [subject,name] of [[requester,'Requesting parent'],[member,'Paul Cranwell'],[stranger,'Private unrelated name']]) {
    i.setPrincipal(subject);accounts.set(subject.toText(),ok(await i.register_account()).id);ok(await i.set_profile(name,[]));
  }
  i.setPrincipal(requester);assert.ok('Err'in await i.read_club_profiles(foreign,'club-0',[member]),'Unconfigured identity must disclose no names');
  const clubs=[];
  for(let n=0;n<2;n++) {
    const c=await pic.setupCanister({idlFactory:clubIdl,wasm:clubWasm,sender:governor,controllers:[governor],arg:clubArg,environmentVariables:[...privacy,{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]});
    c.actor.setPrincipal(governor);ok(await c.actor.set_identity_access_canister(identity.canisterId));
    await pic.updateCanisterSettings({canisterId:c.canisterId,sender:governor,environmentVariables:privacy});
    await pic.upgradeCanister({canisterId:c.canisterId,wasm:clubWasm,sender:governor,arg:clubArg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    c.actor.setPrincipal(governor);ok(await c.actor.create_club(`club-${n}`,`Club ${n}`,'test',[],[]));
    ok(await c.actor.replace_acl(1n,{clubs:[`club-${n}`],teams:[],children:[],guardians:[],exclusions:[],roles:[requester,member].map(user=>({user,role:'member',club:[`club-${n}`],team:[]}))}));
    clubs.push(c);
  }
  const subnet=await pic.getCanisterSubnetId(identity.canisterId);assert.ok(subnet);
  router.actor.setPrincipal(governor);let revision=await router.actor.version();
  for(let n=0;n<2;n++) {
    const domains=names.map((domain,index)=>({domain,canister:domain==='club_domain'?clubs[n].canisterId:domain==='secret_workload_identity'?p(90):p(10+n*30+index)}));
    const group={id:`g${n+1}`,target_alias:'mainnet',domains,photo_store:[],accepting:false,max_clubs:100,assigned_clubs:0,heap_budget_bytes:1_000_000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n};
    revision=ok(await router.actor.register_group(group,revision));
    revision=ok(await router.actor.register_group_placement({group_id:group.id,deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:domains.map(d=>({...d,subnet}))},revision));
  }
  const binding={registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'};
  i.setPrincipal(governor);ok(await i.pin_owner_test_deletion_registry(binding));
  const grants=ok(await i.configure_membership_directory(binding,clubs.map(c=>c.canisterId),1n));
  for(let n=0;n<2;n++) {
    const grant=grants.find(g=>g.group===`g${n+1}`);assert.ok(grant);
    clubs[n].actor.setPrincipal(governor);ok(await clubs[n].actor.configure_membership_directory_source(grant));
  }
  const read=async(n,subjects=[member,stranger])=>{i.setPrincipal(requester);return i.read_club_profiles(clubs[n].canisterId,`club-${n}`,subjects);};
  // Submit without awaiting completion, execute one round, then change the
  // authoritative caller while the inter-canister request is still pending.
  const signature=identityIdl({IDL})._fields.find(([name])=>name==='read_club_profiles')?.[1];assert.ok(signature);
  const pending=await pic.client.submitCall({canisterId:identity.canisterId,sender:requester,method:'read_club_profiles',payload:new Uint8Array(IDL.encode(signature.argTypes,[clubs[0].canisterId,'club-0',[member]]))});
  await pic.tick(1);
  const status=await pic.client.ingressStatus({messageId:{effective_principal:{CanisterId:Buffer.from(identity.canisterId.toUint8Array()).toString('base64')},message_id:pending.messageId},caller:requester});
  assert.equal(status,null,'Profile request must still be pending before the caller is suspended');
  i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(requester.toText()),{Suspended:null}));
  const pendingReply=IDL.decode(signature.retTypes,(await pic.client.awaitCall(pending)).body)[0];
  assert.ok('Err'in pendingReply,'A suspended caller must not receive profiles from an earlier permitted batch');
  i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(requester.toText()),{Active:null}));
  for(let n=0;n<2;n++) {
    const rows=ok(await read(n));assert.equal(rows.length,1);assert.equal(rows[0].display_name,'Paul Cranwell');assert.equal(rows[0].principal.toText(),member.toText());
    assert.equal(ok(await read(n,[member,member])).length,1,'Duplicates cannot widen disclosure');
    i.setPrincipal(stranger);assert.ok('Err'in await i.read_club_profiles(clubs[n].canisterId,`club-${n}`,[member]));
    i.setPrincipal(Principal.anonymous());assert.ok('Err'in await i.read_club_profiles(clubs[n].canisterId,`club-${n}`,[member]));
    i.setPrincipal(requester);assert.ok('Err'in await i.read_club_profiles(foreign,`club-${n}`,[member]));
    assert.ok('Err'in await i.read_club_profiles(clubs[n].canisterId,'foreign-club',[member]));
    assert.ok('Err'in await i.read_club_profiles(clubs[n].canisterId,`club-${n}`,Array(26).fill(member)));
  }
  i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(member.toText()),{Suspended:null}));
  assert.deepEqual(ok(await read(0)),[],'Suspended subjects must not appear');
  i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(member.toText()),{Active:null}));
  i.setPrincipal(member);const reference=`pii-display-name:v1:${clubs[0].canisterId.toText()}:${member.toText()}`;
  ok(await i.set_profile(reference,[]));assert.equal(ok(await read(0))[0].display_name,reference,'Identity carries only opaque reference, never decrypts');
  clubs[0].actor.setPrincipal(governor);ok(await clubs[0].actor.remove_member('club-0',member));
  assert.deepEqual(ok(await read(0)),[]);assert.equal(ok(await read(1)).length,1,'One club removal must not hide other authorized club');
  i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(requester.toText()),{Suspended:null}));
  assert.ok('Err'in await read(1),'Suspended caller cannot disclose names');
  i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(requester.toText()),{Active:null}));
  await pic.stopCanister({canisterId:clubs[1].canisterId,sender:governor});
  assert.ok('Err'in await read(1),'Unavailable authority returns no partial profiles');
  await pic.startCanister({canisterId:clubs[1].canisterId,sender:governor});
  assert.equal(ok(await read(1)).length,1);
  await pic.upgradeCanister({canisterId:identity.canisterId,wasm:identityWasm,sender:governor,arg:init});
  assert.equal(ok(await read(1))[0].display_name,reference,'Registered source/profile survives identity upgrade');
  console.log('PASS: real router-pinned shared identity -> two club services; exact audiences, anonymous/nonmember/foreign refusal, bounded duplicates, suspended caller/subject, club-local removal, reference-only profile, outage recovery and identity upgrade. No live changes.');
} finally {await pic?.tearDown();await server.stop();}