// Real two-source -> shared identity transport. Disposable local canisters;
// no release flags for linked-account lifecycle or public directory cutover.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=p(1),member=p(2),stranger=p(3);
const ok=r=>{assert.ok('Ok' in r,r.Err);return r.Ok;};
const names=['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
const server=await PocketIcServer.start({showCanisterLogs:true});let pic;
try {
  pic=await PocketIc.create(server.getUrl());
  const init=IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}]);
  const router=await pic.setupCanister({idlFactory:routerIdl,wasm:process.env.SHARD_ROUTER_WASM,sender:governor,controllers:[governor],arg:init});
  const identity=await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,controllers:[governor],arg:init,environmentVariables:[{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'}]});
  const clubs=[];
  for(let n=0;n<2;n++) clubs.push(await pic.setupCanister({idlFactory:clubIdl,wasm:process.env.CLUB_DOMAIN_WASM,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])}));
  const subnet=await pic.getCanisterSubnetId(identity.canisterId);assert.ok(subnet);
  router.actor.setPrincipal(governor);let revision=await router.actor.version();
  for(let n=0;n<2;n++) {
    const group={id:`g${n+1}`,target_alias:'mainnet',domains:names.map((domain,i)=>({domain,canister:domain==='club_domain'?clubs[n].canisterId:domain==='secret_workload_identity'?p(90):p(10+n*30+i)})),photo_store:[],accepting:false,max_clubs:100,assigned_clubs:0,heap_budget_bytes:1_000_000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n};
    revision=ok(await router.actor.register_group(group,revision));
    revision=ok(await router.actor.register_group_placement({group_id:group.id,deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:group.domains.map(d=>({...d,subnet}))},revision));
    clubs[n].actor.setPrincipal(governor);ok(await clubs[n].actor.create_club(`club-${n}`,`Club ${n}`,'test',[],[]));
    ok(await clubs[n].actor.replace_acl(1n,{clubs:[`club-${n}`],teams:[],children:[],guardians:[],exclusions:[],roles:[{user:member,role:'member',club:[`club-${n}`],team:[]}]}));
  }
  const binding={registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'};
  identity.actor.setPrincipal(governor);ok(await identity.actor.pin_owner_test_deletion_registry(binding));
  identity.actor.setPrincipal(stranger);assert.ok('Err' in await identity.actor.configure_membership_directory(binding,clubs.map(c=>c.canisterId),1n));
  identity.actor.setPrincipal(governor);
  const grants=ok(await identity.actor.configure_membership_directory(binding,clubs.map(c=>c.canisterId),1n));assert.equal(grants.length,2);
  for(let n=0;n<2;n++) {
    const a=clubs[n].actor,grant=grants.find(g=>g.group===`g${n+1}`);assert.ok(grant);
    a.setPrincipal(stranger);assert.ok('Err' in await a.configure_membership_directory_source(grant));
    a.setPrincipal(governor);ok(await a.configure_membership_directory_source(grant));
    a.setPrincipal(stranger);assert.ok('Err' in await a.read_directory_membership_source_page(grant,[]));
    a.setPrincipal(router.canisterId);assert.ok('Err' in await a.read_directory_membership_status(grant),'other infrastructure denied');
    a.setPrincipal(identity.canisterId);assert.ok('Err' in await a.read_directory_membership_status({...grant,group:'foreign'}));
    const start=ok(await a.read_directory_membership_status(grant));assert.equal(start.pending,true);
    assert.ok('Err' in await a.acknowledge_directory_membership_source(grant,0n));
    assert.ok('Err' in await a.acknowledge_directory_membership_source(grant,start.revision+1n));
  }
  // Background polling and source notifications alone must progress both
  // sources, without an operator invoking the advance endpoint.
  for(let tick=0;tick<30;tick++) {
    await pic.advanceTime(31_000);await pic.tick(15);
    const statuses=[];
    for(let n=0;n<2;n++){clubs[n].actor.setPrincipal(identity.canisterId);statuses.push(ok(await clubs[n].actor.read_directory_membership_status(grants[n])));}
    if(statuses.every(s=>!s.pending))break;
    assert.ok(tick<29,'automatic polling must complete both sources');
  }
  // Dirty one source again; the persisted automatic scheduler re-arms on
  // an ordinary upgrade without resetting acknowledgements or aliases.
  clubs[0].actor.setPrincipal(governor);ok(await clubs[0].actor.remove_member('club-0',member));
  await pic.upgradeCanister({canisterId:identity.canisterId,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,arg:init});
  for(let tick=0;tick<30;tick++){
    await pic.advanceTime(31_000);await pic.tick(15);
    clubs[0].actor.setPrincipal(identity.canisterId);
    if(!ok(await clubs[0].actor.read_directory_membership_status(grants[0])).pending)break;
    assert.ok(tick<29,'automatic scheduler must resume after upgrade');
  }
  clubs[0].actor.setPrincipal(governor);ok(await clubs[0].actor.restore_member('club-0',member));
  identity.actor.setPrincipal(governor);
  const finish=async source=>{
    for(let i=0;i<80;i++) {
      const progress=ok(await identity.actor.advance_membership_directory_source(source));assert.ok(progress.scanned<=100n);
      if(progress.phase==='acknowledged')return progress;
    }throw new Error('Bounded reconstruction did not finish');
  };
  // Upgrade with a persisted pull/materialization request.
  ok(await identity.actor.advance_membership_directory_source('g1'));
  await pic.upgradeCanister({canisterId:identity.canisterId,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,arg:init});
  await finish('g1');await finish('g2');
  // A stopped authority refuses progress without acknowledging away dirty
  // state; the other source continues and restart resumes the pending job.
  clubs[0].actor.setPrincipal(governor);ok(await clubs[0].actor.remove_member('club-0',member));
  await pic.stopCanister({canisterId:clubs[0].canisterId,sender:governor});
  assert.ok('Err' in await identity.actor.advance_membership_directory_source('g1'));
  await finish('g2');
  await pic.startCanister({canisterId:clubs[0].canisterId,sender:governor});
  await finish('g1');
  clubs[0].actor.setPrincipal(governor);ok(await clubs[0].actor.restore_member('club-0',member));await finish('g1');
  // A finite retained source must finish even with a live membership write
  // between every page/materialization call. Old completion stays pending.
  const a=clubs[0].actor,grant=grants[0];
  a.setPrincipal(governor);
  const oldAcl=ok(await a.export_acl());
  ok(await a.replace_acl(oldAcl.acl_version,{...oldAcl.acl,roles:[...oldAcl.acl.roles,...Array.from({length:350},(_,n)=>({user:p(100+n%100),role:'member',club:['club-0'],team:[]}))]}));
  identity.actor.setPrincipal(governor);
  const initial=ok(await identity.actor.advance_membership_directory_source('g1'));assert.equal(initial.phase,'pull');
  let historical=initial.revision,upgraded=false;
  for(let step=0;step<100;step++) {
    a.setPrincipal(governor);ok(await a.remove_member('club-0',member));ok(await a.restore_member('club-0',member));
    if(!upgraded&&step===2){
      await pic.upgradeCanister({canisterId:clubs[0].canisterId,wasm:process.env.CLUB_DOMAIN_WASM,sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
      await pic.upgradeCanister({canisterId:identity.canisterId,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,arg:init});upgraded=true;
    }
    const result=await identity.actor.advance_membership_directory_source('g1');
    if('Err' in result)throw new Error(result.Err);
    const progress=ok(result);assert.ok(progress.scanned<=100n);
    assert.equal(progress.revision,historical,'ongoing writes must not replace retained job');
    if(progress.phase==='acknowledged')break;
    assert.ok(step<99,'historical reconstruction must finish under continuous writes');
  }
  a.setPrincipal(identity.canisterId);
  const stale=ok(await a.read_directory_membership_status(grant));assert.ok(stale.revision>stale.acknowledged);assert.equal(stale.pending,true);
  // Lost completion response is retried idempotently without releasing a
  // newer pending generation. Once writes stop, polling catches up.
  ok(await a.acknowledge_directory_membership_source(grant,stale.acknowledged));
  identity.actor.setPrincipal(governor);await finish('g1');
  for(let n=0;n<2;n++) {
    const a=clubs[n].actor,grant=grants[n];a.setPrincipal(identity.canisterId);const status=ok(await a.read_directory_membership_status(grant));assert.equal(status.pending,false);assert.equal(status.acknowledged,status.revision);
    await pic.upgradeCanister({canisterId:clubs[n].canisterId,wasm:process.env.CLUB_DOMAIN_WASM,sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    assert.deepEqual(ok(await a.read_directory_membership_status(grant)),status);
    a.setPrincipal(governor);ok(await a.remove_member(`club-${n}`,member));
    a.setPrincipal(identity.canisterId);const dirty=ok(await a.read_directory_membership_status(grant));assert.ok(dirty.revision>status.revision);assert.equal(dirty.pending,true);
    identity.actor.setPrincipal(stranger);assert.ok('Err' in await identity.actor.invalidate_membership_directory_source(grant,dirty.revision));
    identity.actor.setPrincipal(clubs[n].canisterId);ok(await identity.actor.invalidate_membership_directory_source(grant,dirty.revision));
    identity.actor.setPrincipal(governor);await finish(`g${n+1}`);
    a.setPrincipal(identity.canisterId);assert.equal(ok(await a.read_directory_membership_status(grant)).pending,false);
    a.setPrincipal(governor);ok(await a.disable_membership_directory_source());a.setPrincipal(identity.canisterId);assert.ok('Err' in await a.read_directory_membership_status(grant));
  }
  identity.actor.setPrincipal(governor);
  for(let i=0;i<40;i++){const r=ok(await identity.actor.reclaim_membership_directory());assert.ok(r.scanned<=100n);if(r.complete)break;assert.ok(i<39);}
  assert.ok('Err' in await identity.actor.set_club_authorities(clubs.map(c=>c.canisterId)),'lifecycle release remains closed');
  assert.equal(typeof identity.actor.read_my_membership_directory_page,'undefined','no premature public cutover');
  console.log('PASS: real two-source automatic polling, exact permissions, durable timer/upgrade progress, source acknowledgement/readback, removal refresh, source outage/restart and bounded cleanup; Stage A retained.');
} finally {if(pic)await pic.tearDown();await server.stop();}