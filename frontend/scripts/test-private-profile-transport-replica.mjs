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
  const sources=clubs.map(c=>c.canisterId);
  let relay;
  if (process.env.PROFILE_MEMBERSHIP_RELAY_WASM) {
    const batchType=clubIdl({IDL})._fields.find(([name])=>name==='read_profile_membership_batch')?.[1];assert.ok(batchType);
    const relayIdl=({IDL})=>IDL.Service({
      read_profile_membership_batch:batchType,
      hold_on:IDL.Func([IDL.Nat],[],[]),release:IDL.Func([],[],[]),
      progress:IDL.Func([],[IDL.Nat,IDL.Nat,IDL.Bool],['query']),
    });
    relay=await pic.setupCanister({idlFactory:relayIdl,wasm:process.env.PROFILE_MEMBERSHIP_RELAY_WASM,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal,IDL.Principal,IDL.Principal],[governor,clubs[0].canisterId,identity.canisterId])});
    await pic.updateCanisterSettings({canisterId:clubs[0].canisterId,sender:governor,environmentVariables:[...privacy,{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]});
    // Setter reads current runtime environment; no admission-enabled upgrade
    // is performed, so only the intended test delegation changes.
    clubs[0].actor.setPrincipal(governor);ok(await clubs[0].actor.set_identity_access_canister(relay.canisterId));
    await pic.updateCanisterSettings({canisterId:clubs[0].canisterId,sender:governor,environmentVariables:privacy});
    sources[0]=relay.canisterId;
  }
  router.actor.setPrincipal(governor);let revision=await router.actor.version();
  for(let n=0;n<2;n++) {
    const domains=names.map((domain,index)=>({domain,canister:domain==='club_domain'?sources[n]:domain==='secret_workload_identity'?p(90):p(10+n*30+index)}));
    const group={id:`g${n+1}`,target_alias:'mainnet',domains,photo_store:[],accepting:false,max_clubs:100,assigned_clubs:0,heap_budget_bytes:1_000_000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n};
    revision=ok(await router.actor.register_group(group,revision));
    revision=ok(await router.actor.register_group_placement({group_id:group.id,deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:domains.map(d=>({...d,subnet}))},revision));
  }
  const binding={registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'};
  i.setPrincipal(governor);ok(await i.pin_owner_test_deletion_registry(binding));
  const grants=ok(await i.configure_membership_directory(binding,sources,1n));
  for(let n=0;n<2;n++) {
    const grant=grants.find(g=>g.group===`g${n+1}`);assert.ok(grant);
    if (n===0 && relay) continue; // Test relay does not implement directory pages.
    clubs[n].actor.setPrincipal(governor);ok(await clubs[n].actor.configure_membership_directory_source(grant));
  }
  const read=async(n,subjects=[member,stranger])=>{i.setPrincipal(requester);return i.read_club_profiles(sources[n],`club-${n}`,subjects);};
  // In-flight callback tests require a dedicated held-response authority.
  // A tick alone completes this same-subnet flow and cannot prove interruption.
  for(let n=0;n<2;n++) {
    const rows=ok(await read(n));assert.equal(rows.length,1);assert.equal(rows[0].display_name,'Paul Cranwell');assert.equal(rows[0].principal.toText(),member.toText());
    assert.equal(ok(await read(n,[member,member])).length,1,'Duplicates cannot widen disclosure');
    i.setPrincipal(stranger);assert.ok('Err'in await i.read_club_profiles(sources[n],`club-${n}`,[member]));
    i.setPrincipal(Principal.anonymous());assert.ok('Err'in await i.read_club_profiles(sources[n],`club-${n}`,[member]));
    i.setPrincipal(requester);assert.ok('Err'in await i.read_club_profiles(foreign,`club-${n}`,[member]));
    assert.ok('Err'in await i.read_club_profiles(sources[n],'foreign-club',[member]));
    assert.ok('Err'in await i.read_club_profiles(sources[n],`club-${n}`,Array(26).fill(member)));
  }
  // Real bounded guardian directory pages, independently of club membership
  // search and without a plaintext substring query or name sidecar.
  const guardianClub=clubs[1];
  guardianClub.actor.setPrincipal(governor);
  ok(await guardianClub.actor.replace_acl(1n,{clubs:['club-1'],teams:[],children:[{id:'guardian-search-child',parent:[requester],club_id:['club-1'],teams:[]}],guardians:[],exclusions:[],roles:[requester,member].map(user=>({user,role:'member',club:['club-1'],team:[]}))}));
  const directoryPeople=[];
  for(let n=0;n<30;n++) {
    const subject=p(150+n);i.setPrincipal(subject);ok(await i.register_account());ok(await i.set_profile(`Guardian candidate ${n}`,[]));directoryPeople.push(subject);
  }
  i.setPrincipal(Principal.anonymous());assert.ok('Err'in await i.read_guardian_profile_candidates(sources[1],'guardian-search-child',[]));
  i.setPrincipal(stranger);assert.ok('Err'in await i.read_guardian_profile_candidates(sources[1],'guardian-search-child',[]),'Non-guardian must not enumerate the directory');
  i.setPrincipal(requester);assert.ok('Err'in await i.read_guardian_profile_candidates(foreign,'guardian-search-child',[]));
  const firstGuardian=ok(await i.read_guardian_profile_candidates(sources[1],'guardian-search-child',[]));
  assert.ok(firstGuardian.rows.length<=25&&firstGuardian.scanned<=100&&firstGuardian.next.length===1);
  const secondGuardian=ok(await i.read_guardian_profile_candidates(sources[1],'guardian-search-child',firstGuardian.next));
  assert.equal(secondGuardian.revision,firstGuardian.revision);
  const firstIds=new Set(firstGuardian.rows.map(row=>row.principal.toText()));
  assert.ok(secondGuardian.rows.every(row=>!firstIds.has(row.principal.toText())),'Stable cursor never duplicates candidates');
  assert.ok('Err'in await i.read_guardian_profile_candidates(sources[1],'another-child',firstGuardian.next),'Cursor cannot authorize another child');
  const subject=firstGuardian.rows[0].principal;
  const confirmedGuardian=ok(await i.read_guardian_profiles(sources[1],'guardian-search-child',[subject],firstGuardian.revision));
  assert.equal(confirmedGuardian[0].principal.toText(),subject.toText());
  i.setPrincipal(directoryPeople[0]);ok(await i.set_profile('Changed candidate',[]));i.setPrincipal(requester);
  assert.ok('Err'in await i.read_guardian_profile_candidates(sources[1],'guardian-search-child',firstGuardian.next),'Profile writes invalidate continuations');
  assert.ok('Err'in await i.read_guardian_profiles(sources[1],'guardian-search-child',[subject],firstGuardian.revision),'Retained matches cannot read back at a stale revision');
  const freshGuardian=ok(await i.read_guardian_profile_candidates(sources[1],'guardian-search-child',[]));
  guardianClub.actor.setPrincipal(governor);ok(await guardianClub.actor.replace_acl(1n,{clubs:['club-1'],teams:[],children:[],guardians:[],exclusions:[],roles:[requester,member].map(user=>({user,role:'member',club:['club-1'],team:[]}))}));
  i.setPrincipal(requester);assert.ok('Err'in await i.read_guardian_profiles(sources[1],'guardian-search-child',freshGuardian.rows.map(row=>row.principal),freshGuardian.revision),'Guardian removal refuses retained matches');
  console.log('PASS: real exact-child guardian directory paging, <=100 scans/25 candidates, no duplicates, child-bound continuation, stale-profile rejection and guardian removal.');
  if (relay) {
    const signature=identityIdl({IDL})._fields.find(([name])=>name==='read_club_profiles')?.[1];assert.ok(signature);
    const hold=async(at)=>{
      relay.actor.setPrincipal(governor);await relay.actor.hold_on(BigInt(at));
      const pending=await pic.client.submitCall({canisterId:identity.canisterId,sender:requester,method:'read_club_profiles',payload:new Uint8Array(IDL.encode(signature.argTypes,[sources[0],'club-0',[member]]))});
      let observed=false;
      for(let n=0;n<60;n++) {await pic.tick(1);const progress=await relay.actor.progress();if(progress[1]===BigInt(at)&&!progress[2]){observed=true;break;}}
      assert.ok(observed,`Actual membership reply ${at} must be held before mutation`);
      return async()=>{await relay.actor.release();return IDL.decode(signature.retTypes,(await pic.client.awaitCall(pending)).body)[0];};
    };
    for(const at of [1,2]) {
      const finish=await hold(at);i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(requester.toText()),{Suspended:null}));
      assert.ok('Err'in await finish(),`Caller suspension at reply ${at} must suppress all names`);
      i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(requester.toText()),{Active:null}));
      assert.equal(ok(await read(0)).length,1,'Exact authorized retry succeeds');
    }
    for (const at of [1,2]) {
      const finishConfig = await hold(at);
      i.setPrincipal(governor);
      const replacement=await i.configure_membership_directory(binding,sources,BigInt(at+1));
      assert.ok('Err' in replacement && replacement.Err.includes('fenced recovery'), 'Ordinary configuration replacement must remain unavailable');
      assert.equal(ok(await finishConfig()).length,1,'Rejected configuration mutation does not poison an authorized held read');
      assert.equal(ok(await read(0)).length,1,'Retry retains the original configuration');
    }
    for (const at of [1,2]) {
      const alias=p(110+at);
      const finishLink=await hold(at);
      i.setPrincipal(requester);const challenge=ok(await i.begin_link(alias));
      i.setPrincipal(alias);ok(await i.accept_link(challenge.id));
      assert.ok('Err' in await finishLink(), `Caller account link change at reply ${at} must disclose no names`);
      assert.equal(ok(await read(0)).length,1,'Retry binds the new account version');
    }
    const finishSubjectLink=await hold(2);
    const memberAlias=p(120);
    i.setPrincipal(member);const challenge=ok(await i.begin_link(memberAlias));
    i.setPrincipal(memberAlias);ok(await i.accept_link(challenge.id));
    assert.deepEqual(ok(await finishSubjectLink()),[],'Subject account link change must discard held names');
    assert.equal(ok(await read(0)).length,1,'Subject retry binds updated identity');
    const finishSubject=await hold(2);i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(member.toText()),{Suspended:null}));
    assert.deepEqual(ok(await finishSubject()),[],'Subject suspended during final reply cannot appear');
    i.setPrincipal(governor);ok(await i.set_account_status(accounts.get(member.toText()),{Active:null}));
    const finishRole=await hold(1);clubs[0].actor.setPrincipal(governor);ok(await clubs[0].actor.remove_member('club-0',member));
    assert.ok('Err'in await finishRole(),'Membership mutation between batches invalidates exact revision');
    clubs[0].actor.setPrincipal(governor);ok(await clubs[0].actor.restore_member('club-0',member));ok(await clubs[0].actor.add_role_grant(member,'club-0','member',[]));
    assert.equal(ok(await read(0)).length,1);
    console.log('PASS: observed actual first/second held replies; caller suspension and account-link drift at both boundaries, final subject suspension/link drift, blocked configuration replacement and between-batch club removal; healthy retry controls.');
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