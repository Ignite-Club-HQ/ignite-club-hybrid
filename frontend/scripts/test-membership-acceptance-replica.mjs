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
const governor = p(1), stranger = p(2), member = p(3), single = p(4);
const ok = reply => { assert.ok('Ok' in reply, reply.Err); return reply.Ok; };
const names = ['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const init = IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}]);
  const router = await pic.setupCanister({idlFactory:routerIdl,wasm:process.env.SHARD_ROUTER_WASM,sender:governor,controllers:[governor],arg:init});
  const identity = await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,controllers:[governor],arg:init,environmentVariables:[{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'}]});
  const sources = [];
  for (let n=0;n<3;n++) sources.push(await pic.setupCanister({idlFactory:clubIdl,wasm:process.env.CLUB_DOMAIN_WASM,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])}));
  const subnet = await pic.getCanisterSubnetId(identity.canisterId);assert.ok(subnet);
  router.actor.setPrincipal(governor);let revision = await router.actor.version();
  for(let n=0;n<3;n++) {
    const group = {id:`g${n+1}`,target_alias:'mainnet',domains:names.map((domain,i)=>({domain,canister:domain==='club_domain'?sources[n].canisterId:domain==='secret_workload_identity'?p(90):p(10+n*30+i)})),photo_store:[],accepting:true,max_clubs:1,assigned_clubs:0,heap_budget_bytes:1000000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n};
    revision=ok(await router.actor.register_group(group,revision));
    revision=ok(await router.actor.register_group_placement({group_id:group.id,deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:group.domains.map(d=>({...d,subnet}))},revision));
    revision=ok(await router.actor.record_group_health(group.id,100n,1_000_000_000_000n,revision));
    const assignment=ok(await router.actor.assign_new_club_group(`club-${n}`,'mainnet',revision));revision=assignment.revision;assert.equal(assignment.group_id,group.id);
    sources[n].actor.setPrincipal(governor);ok(await sources[n].actor.create_club(`club-${n}`,`Club ${n}`,'test',[],[]));
    ok(await sources[n].actor.add_role_grant(member,`club-${n}`,'player',[]));
    if(n===0)ok(await sources[n].actor.add_role_grant(single,`club-${n}`,'player',[]));

  }
  const binding = {registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'};
  identity.actor.setPrincipal(governor);ok(await identity.actor.pin_owner_test_deletion_registry(binding));
  const grants=ok(await identity.actor.configure_membership_directory(binding,sources.map(s=>s.canisterId),1n));
  for(let n=0;n<3;n++){sources[n].actor.setPrincipal(governor);ok(await sources[n].actor.configure_membership_directory_source(grants[n]));}
  identity.actor.setPrincipal(stranger);assert.ok('Err' in await identity.actor.check_membership_directory_acceptance());
  identity.actor.setPrincipal(governor);
  assert.ok('Err' in await identity.actor.check_membership_directory_acceptance(),'unfinished fill cannot pass');
  const fill=async id=>{for(let at=0;at<100;at++){const r=ok(await identity.actor.advance_membership_directory_source(id));assert.ok(r.scanned<=100n);if(r.phase==='acknowledged')return;}throw Error('Fill budget exceeded');};
  await fill('g1');await fill('g2');await fill('g3');
  for(let at=0;at<20;at++){if(ok(await identity.actor.advance_membership_directory_ownership()).complete)break;assert.ok(at<19);}
  const accepted=ok(await identity.actor.check_membership_directory_acceptance());
  assert.equal(accepted.snapshot_verified,true);assert.equal(accepted.restoration_guard_verified,true);
  assert.equal(accepted.source_revisions.length,3);assert.equal(accepted.verified_current,false);assert.equal(accepted.app_enabled,false);
  const release='a'.repeat(40);
  identity.actor.setPrincipal(stranger);assert.ok('Err' in await identity.actor.enable_membership_directory(release));
  identity.actor.setPrincipal(governor);assert.equal(ok(await identity.actor.enable_membership_directory(release)).app_enabled,true);
  assert.equal(ok(await identity.actor.enable_membership_directory(release)).app_enabled,true,'exact release retry');
  assert.ok('Err' in await identity.actor.enable_membership_directory('b'.repeat(40)));
  for(const human of [member,single,stranger]){identity.actor.setPrincipal(human);ok(await identity.actor.register_account());}
  identity.actor.setPrincipal(member);
  const first=ok(await identity.actor.read_my_membership_directory(10n,[]));assert.equal(first.page.verified_current,true);assert.deepEqual(first.page.rows.map(r=>r.club_id),['club-0']);assert.ok(first.instance>0n);
  let cursor=first.page.next;const clubs=first.page.rows.map(r=>r.club_id);
  while(cursor.length){const page=ok(await identity.actor.read_my_membership_directory(10n,cursor));assert.equal(page.instance,first.instance);clubs.push(...page.page.rows.map(r=>r.club_id));cursor=page.page.next;}
  assert.deepEqual(clubs,['club-0','club-1','club-2']);
  assert.ok('Err' in await identity.actor.read_my_membership_directory(10n,[]),'old start after advanced traversal must not rewind');
  identity.actor.setPrincipal(single);const own=ok(await identity.actor.read_my_membership_directory(11n,[]));assert.deepEqual(own.page.rows.map(r=>r.club_id),['club-0']);assert.equal(own.page.next.length,0);
  identity.actor.setPrincipal(stranger);const empty=ok(await identity.actor.read_my_membership_directory(12n,[]));assert.equal(empty.page.rows.length,0);assert.equal(empty.page.next.length,0);
  assert.ok('Err' in await identity.actor.read_my_membership_directory(10n,first.page.next),'foreign continuation');
  identity.actor.setPrincipal(member);const account=ok(await identity.actor.register_account());
  identity.actor.setPrincipal(governor);ok(await identity.actor.set_account_status(account.id,{Suspended:null}));
  identity.actor.setPrincipal(member);assert.ok('Err' in await identity.actor.read_my_membership_directory(10n,first.page.next),'suspended replay');
  identity.actor.setPrincipal(governor);ok(await identity.actor.set_account_status(account.id,{Active:null}));
  const deferred=pic.createDeferredActor(identityIdl,identity.canisterId);deferred.setPrincipal(member);
  const pending=await deferred.read_my_membership_directory(13n,[]);
  await pic.tick(1);
  identity.actor.setPrincipal(governor);ok(await identity.actor.set_account_status(account.id,{Suspended:null}));
  assert.ok('Err' in await pending(),'caller suspension during consensus awaits must refuse');
  ok(await identity.actor.set_account_status(account.id,{Active:null}));

  // Snapshot accepted identity AND a source. Loading either later must be
  // detectable even if application revisions and Wasm hashes are unchanged.
  const management=async(method,type,arg,outputs=[])=>IDL.decode(outputs,await pic.updateCall({canisterId:Principal.managementCanister(),method,sender:governor,arg:IDL.encode([type],[arg])}));
  const snapshotType=IDL.Record({id:IDL.Vec(IDL.Nat8),taken_at_timestamp:IDL.Nat64,total_size:IDL.Nat64});
  const take=async canisterId=>{await pic.stopCanister({canisterId,sender:governor});const [snapshot]=await management('take_canister_snapshot',IDL.Record({canister_id:IDL.Principal,replace_snapshot:IDL.Opt(IDL.Vec(IDL.Nat8))}),{canister_id:canisterId,replace_snapshot:[]},[snapshotType]);await pic.startCanister({canisterId,sender:governor});return snapshot;};
  const load=async(canisterId,snapshot)=>{await pic.stopCanister({canisterId,sender:governor});await management('load_canister_snapshot',IDL.Record({canister_id:IDL.Principal,snapshot_id:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)}),{canister_id:canisterId,snapshot_id:snapshot.id,sender_canister_version:[]});await pic.startCanister({canisterId,sender:governor});};
  const identitySnapshot=await take(identity.canisterId),sourceSnapshot=await take(sources[0].canisterId);
  ok(await identity.actor.check_membership_directory_acceptance(),'ordinary stop/start and taking snapshots do not change acceptance');
  sources[0].actor.setPrincipal(governor);ok(await sources[0].actor.remove_member('club-0',member));
  identity.actor.setPrincipal(member);assert.ok('Err' in await identity.actor.read_my_membership_directory(10n,first.page.next),'membership change refuses old pages');
  identity.actor.setPrincipal(governor);
  assert.ok('Err' in await identity.actor.check_membership_directory_acceptance(),'mutation with notification not relied on cannot pass old ownership');
  // Release-time ownership must not require an operator after ordinary edits.
  // Existing timers finish the changed source and bounded ownership rebuild.
  identity.actor.setPrincipal(member);let refreshed;
  for(let tick=0;tick<40;tick++){
    await pic.advanceTime(31_000);await pic.tick(20);
    const result=await identity.actor.read_my_membership_directory(14n,[]);
    if('Ok' in result){refreshed=result.Ok;break;}
  }
  assert.ok(refreshed,'automatic released-directory update must become readable');
  assert.deepEqual(refreshed.page.rows.map(r=>r.club_id),['club-1'],'removed club absent after automatic refresh');
  identity.actor.setPrincipal(governor);
  await load(sources[0].canisterId,sourceSnapshot);
  const sourceRestored=await identity.actor.check_membership_directory_acceptance();assert.ok('Err' in sourceRestored);assert.match(sourceRestored.Err,/lifecycle/);
  identity.actor.setPrincipal(single);assert.ok('Err' in await identity.actor.read_my_membership_directory(11n,[]),'source restore rejects private replay');identity.actor.setPrincipal(governor);
  await load(identity.canisterId,identitySnapshot);
  const jointlyRestored=await identity.actor.check_membership_directory_acceptance();assert.ok('Err' in jointlyRestored);assert.match(jointlyRestored.Err,/lifecycle/);
  assert.ok('Err' in await identity.actor.configure_membership_directory(binding,sources.map(s=>s.canisterId),1n),'ordinary configure cannot repin restored state');
  console.log('PASS: populated three-source released pages, single/multiple/empty callers, suspension during awaits/replay/source drift; real fill/ownership/snapshot check and same-Wasm/joint restore refusal. Disposable canisters only; nothing enabled live.');
} finally { if(pic)await pic.tearDown();await server.stop(); }