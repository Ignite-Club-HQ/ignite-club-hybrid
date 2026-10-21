// Real router/identity production predicate; destination IDs are metadata,
// not evidence of live club creation or all-service acceptance.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
const p=n=>Principal.fromUint8Array(new Uint8Array([n,1]));
const governor=p(1),user=p(2),unknown=p(3),ok=r=>{assert.ok('Ok' in r,r.Err);return r.Ok;};
const names=['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain',
  'media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
const server=await PocketIcServer.start();let pic;
try{
  pic=await PocketIc.create(server.getUrl());
  const router=await pic.setupCanister({idlFactory:routerIdl,wasm:process.env.SHARD_ROUTER_WASM,sender:governor,controllers:[governor],
    arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
  const identity=await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,controllers:[governor],
    environmentVariables:[{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'}],arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
  const subnet=await pic.getCanisterSubnetId(identity.canisterId);assert.ok(subnet);
  router.actor.setPrincipal(governor);
  const group={id:'g2',target_alias:'mainnet',domains:names.map((domain,i)=>({domain,canister:p(30+i)})),photo_store:[p(90)],
    accepting:false,max_clubs:10,assigned_clubs:0,heap_budget_bytes:1_000_000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n};
  let revision=ok(await router.actor.register_group(group,await router.actor.version()));
  const placement={group_id:'g2',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',
    primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:group.domains.map(d=>({...d,subnet}))};
  revision=ok(await router.actor.register_group_placement(placement,revision));
  const binding={registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,
    host:'https://icp-api.io',network_kind:'public_mainnet'};
  identity.actor.setPrincipal(governor);ok(await identity.actor.pin_owner_test_deletion_registry(binding));
  identity.actor.setPrincipal(user);const account=ok(await identity.actor.register_account());
  assert.ok('Err' in await identity.actor.authorize_group2_admission(binding),'Human cannot grant readers');
  identity.actor.setPrincipal(p(30));assert.ok('Err' in await identity.actor.read_principal_eligibility(user),'Closed before grant');
  identity.actor.setPrincipal(governor);
  assert.ok('Err' in await identity.actor.authorize_group2_admission({...binding,registry_revision:revision-1n}),'Stale registry denied');
  ok(await identity.actor.authorize_group2_admission(binding));ok(await identity.actor.authorize_group2_admission(binding));
  const evidence=ok(await identity.actor.read_group_opening_configuration());
  assert.equal(evidence.find(r=>r[0]==='account_admission_released')[1],'true');
  assert.equal(evidence.filter(r=>r[0]==='eligibility_authority').length,12);
  identity.actor.setPrincipal(p(30));assert.ok('Eligible' in ok(await identity.actor.read_principal_eligibility(user)).decision);
  assert.ok('Denied' in ok(await identity.actor.read_principal_eligibility(unknown)).decision);
  assert.ok('Err' in await identity.actor.read_service_account(user),'Full account reads stay unreleased');
  identity.actor.setPrincipal(p(41));assert.ok('Err' in await identity.actor.read_principal_eligibility(user),'Timer is not an admission reader');
  identity.actor.setPrincipal(governor);assert.ok('Err' in await identity.actor.set_club_authorities([p(30)]),'Lifecycle stays unreleased');
  assert.ok('Err' in await identity.actor.read_removal_history_manifest(),'Recovery stays unreleased');
  ok(await identity.actor.set_account_status(account.id,{Suspended:null}));
  identity.actor.setPrincipal(p(30));assert.ok('Denied' in ok(await identity.actor.read_principal_eligibility(user)).decision);
  await pic.upgradeCanister({canisterId:identity.canisterId,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,
    arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
  assert.ok('Denied' in ok(await identity.actor.read_principal_eligibility(user)).decision,'Suspension survives upgrade');
  identity.actor.setPrincipal(governor);ok(await identity.actor.set_account_status(account.id,{Active:null}));
  identity.actor.setPrincipal(p(90));assert.ok('Eligible' in ok(await identity.actor.read_principal_eligibility(user)).decision,'Dedicated store grant survives upgrade');
  identity.actor.setPrincipal(user);assert.ok('Err' in await identity.actor.disable_group2_admission(),'Human cannot disable');
  identity.actor.setPrincipal(governor);ok(await identity.actor.disable_group2_admission());
  identity.actor.setPrincipal(p(30));assert.ok('Err' in await identity.actor.read_principal_eligibility(user));
  router.actor.setPrincipal(governor);assert.equal(ok(await router.actor.list_groups())[0].accepting,false,'Repair never opens placement');
  console.log('PASS real router/identity: exact 12 readers, governor-only grant/disable, stale denial, eligibility/suspension, lifecycle isolation and upgrade persistence. Destination club creation not exercised.');
}finally{if(pic)await pic.tearDown();await server.stop();}