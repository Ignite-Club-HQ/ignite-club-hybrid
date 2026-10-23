// Actual consensus checker and replica snapshot reloads. Disposable canisters
// only; no app activation, governor boolean or synthetic lifecycle evidence.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
const p = n => Principal.fromUint8Array(Uint8Array.of(n, 1));
const governor = p(1), stranger = p(2);
const ok = reply => { assert.ok('Ok' in reply, reply.Err); return reply.Ok; };
const names = ['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const init = IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}]);
  const router = await pic.setupCanister({idlFactory:routerIdl,wasm:process.env.SHARD_ROUTER_WASM,sender:governor,controllers:[governor],arg:init});
  const identity = await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,controllers:[governor],arg:init,environmentVariables:[{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'}]});
  const sources = [];
  for (let n=0;n<2;n++) sources.push(await pic.setupCanister({idlFactory:clubIdl,wasm:process.env.CLUB_DOMAIN_WASM,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])}));
  const subnet = await pic.getCanisterSubnetId(identity.canisterId);assert.ok(subnet);
  router.actor.setPrincipal(governor);let revision = await router.actor.version();
  for(let n=0;n<2;n++) {
    const group = {id:`g${n+1}`,target_alias:'mainnet',domains:names.map((domain,i)=>({domain,canister:domain==='club_domain'?sources[n].canisterId:domain==='secret_workload_identity'?p(90):p(10+n*30+i)})),photo_store:[],accepting:false,max_clubs:100,assigned_clubs:0,heap_budget_bytes:1000000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n};
    revision=ok(await router.actor.register_group(group,revision));
    revision=ok(await router.actor.register_group_placement({group_id:group.id,deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:group.domains.map(d=>({...d,subnet}))},revision));
  }
  const binding = {registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'};
  identity.actor.setPrincipal(governor);ok(await identity.actor.pin_owner_test_deletion_registry(binding));
  const grants=ok(await identity.actor.configure_membership_directory(binding,sources.map(s=>s.canisterId),1n));
  for(let n=0;n<2;n++){sources[n].actor.setPrincipal(governor);ok(await sources[n].actor.configure_membership_directory_source(grants[n]));}
  identity.actor.setPrincipal(stranger);assert.ok('Err' in await identity.actor.check_membership_directory_acceptance());
  identity.actor.setPrincipal(governor);
  assert.ok('Err' in await identity.actor.check_membership_directory_acceptance(),'unfinished fill cannot pass');
  const fill=async id=>{for(let at=0;at<100;at++){const r=ok(await identity.actor.advance_membership_directory_source(id));assert.ok(r.scanned<=100n);if(r.phase==='acknowledged')return;}throw Error('Fill budget exceeded');};
  await fill('g1');await fill('g2');
  for(let at=0;at<20;at++){if(ok(await identity.actor.advance_membership_directory_ownership()).complete)break;assert.ok(at<19);}
  const accepted=ok(await identity.actor.check_membership_directory_acceptance());
  assert.equal(accepted.snapshot_verified,true);assert.equal(accepted.restoration_guard_verified,true);
  assert.equal(accepted.source_revisions.length,2);assert.equal(accepted.verified_current,false);assert.equal(accepted.app_enabled,false);
  // Snapshot accepted identity AND a source. Loading either later must be
  // detectable even if application revisions and Wasm hashes are unchanged.
  const management=async(method,type,arg,outputs=[])=>IDL.decode(outputs,await pic.updateCall({canisterId:Principal.managementCanister(),method,sender:governor,arg:IDL.encode([type],[arg])}));
  const snapshotType=IDL.Record({id:IDL.Vec(IDL.Nat8),taken_at_timestamp:IDL.Nat64,total_size:IDL.Nat64});
  const take=async canisterId=>{await pic.stopCanister({canisterId,sender:governor});const [snapshot]=await management('take_canister_snapshot',IDL.Record({canister_id:IDL.Principal,replace_snapshot:IDL.Opt(IDL.Vec(IDL.Nat8))}),{canister_id:canisterId,replace_snapshot:[]},[snapshotType]);await pic.startCanister({canisterId,sender:governor});return snapshot;};
  const load=async(canisterId,snapshot)=>{await pic.stopCanister({canisterId,sender:governor});await management('load_canister_snapshot',IDL.Record({canister_id:IDL.Principal,snapshot_id:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)}),{canister_id:canisterId,snapshot_id:snapshot.id,sender_canister_version:[]});await pic.startCanister({canisterId,sender:governor});};
  const identitySnapshot=await take(identity.canisterId),sourceSnapshot=await take(sources[0].canisterId);
  ok(await identity.actor.check_membership_directory_acceptance(),'ordinary stop/start and taking snapshots do not change acceptance');
  sources[0].actor.setPrincipal(governor);ok(await sources[0].actor.create_club('new-test','New test','test',[],[]));
  assert.ok('Err' in await identity.actor.check_membership_directory_acceptance(),'mutation with notification not relied on cannot pass old ownership');
  await load(sources[0].canisterId,sourceSnapshot);
  const sourceRestored=await identity.actor.check_membership_directory_acceptance();assert.ok('Err' in sourceRestored);assert.match(sourceRestored.Err,/lifecycle/);
  await load(identity.canisterId,identitySnapshot);
  const jointlyRestored=await identity.actor.check_membership_directory_acceptance();assert.ok('Err' in jointlyRestored);assert.match(jointlyRestored.Err,/lifecycle/);
  assert.ok('Err' in await identity.actor.configure_membership_directory(binding,sources.map(s=>s.canisterId),1n),'ordinary configure cannot repin restored state');
  console.log('PASS: real two-source fill/ownership/snapshot check, caller refusal, incomplete/mutated refusal, same-Wasm source reload, jointly restored identity/source refusal; app remains disabled.');
} finally { if(pic)await pic.tearDown();await server.stop(); }