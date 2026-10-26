// Disposable real club authorities; never uses a live host or deployment key.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=p(1), requester=p(2), member=p(3), stranger=p(4), identity=p(5), parent=p(6);
const wasm=resolve(import.meta.dirname,'../../backend/club_domain/.mops/.build/club_domain.wasm');
const arg=IDL.encode([IDL.Principal],[governor]);
const privacy=[{name:'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL',value:'1'}];
const ok=r=>{assert.ok('Ok'in r,r.Err);return r.Ok;};
const server=await PocketIcServer.start();let pic;
try {
  pic=await PocketIc.create(server.getUrl());
  const groups=[];
  for(const id of ['club-a','club-b']) {
    const f=await pic.setupCanister({idlFactory,wasm,sender:governor,controllers:[governor],arg,environmentVariables:[...privacy,{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]});
    const a=f.actor;a.setPrincipal(governor);
    ok(await a.set_identity_access_canister(identity));
    // Only the local rehearsal canister is reconfigured: linked-account
    // admission is not required to exercise existing direct membership rules.
    await pic.updateCanisterSettings({canisterId:f.canisterId,sender:governor,environmentVariables:privacy});
    await pic.upgradeCanister({canisterId:f.canisterId,wasm,sender:governor,arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    a.setPrincipal(governor);ok(await a.create_club(id,id,id,[],[]));
    ok(await a.replace_acl(1n,{clubs:[id],teams:[{id:`${id}-team`,club:id}],children:[{id:`${id}-child`,parent:[parent],club_id:[id],teams:[`${id}-team`]}],guardians:[],exclusions:[],roles:[
      {user:requester,role:'member',club:[id],team:[]}, {user:member,role:'member',club:[id],team:[]}
    ]}));
    const subjects=[member,stranger,parent];
    a.setPrincipal(requester);
    const candidates=ok(await a.read_profile_candidates(id,[]));
    assert.ok(candidates.scanned<=100n && candidates.subjects.length<=25);
    assert.deepEqual(new Set(candidates.subjects.map(p=>p.toText())),new Set([requester,member,parent].map(p=>p.toText())));
    a.setPrincipal(stranger);assert.ok('Err'in await a.read_profile_candidates(id,[]));
    a.setPrincipal(Principal.anonymous());assert.ok('Err'in await a.read_profile_candidates(id,[]));
    a.setPrincipal(requester);assert.ok('Err'in await a.read_profile_candidates(id,[{revision:candidates.revision,phase:3n,offset:0n}]));
    a.setPrincipal(requester);assert.ok('Err'in await a.read_profile_membership_batch(requester,id,subjects,[]),'Humans cannot impersonate the identity service');
    a.setPrincipal(Principal.anonymous());assert.ok('Err'in await a.read_profile_membership_batch(requester,id,subjects,[]));
    a.setPrincipal(identity);
    assert.ok('Err'in await a.read_profile_membership_batch(stranger,id,subjects,[]),'Nonmember requester cannot enumerate candidates');
    assert.ok('Err'in await a.read_profile_membership_batch(requester,'foreign-club',subjects,[]));
    assert.ok('Err'in await a.read_profile_membership_batch(requester,id,Array(26).fill(member),[]));
    const first=ok(await a.read_profile_membership_batch(requester,id,subjects,[]));
    assert.deepEqual(first.members,[true,false,true]);
    assert.equal(first.requester.toText(),requester.toText());assert.equal(first.club,id);
    assert.deepEqual(ok(await a.read_profile_membership_batch(requester,id,subjects,[first.revision])),first);
    a.setPrincipal(governor);ok(await a.remove_member(id,member));a.setPrincipal(identity);
    a.setPrincipal(requester);assert.ok('Err'in await a.read_profile_candidates(id,[{revision:candidates.revision,phase:0n,offset:0n}]),'Candidate pages reject stale revision');a.setPrincipal(identity);
    assert.ok('Err'in await a.read_profile_membership_batch(requester,id,subjects,[first.revision]),'Stale first observation must reject the whole batch');
    const removed=ok(await a.read_profile_membership_batch(requester,id,subjects,[]));assert.deepEqual(removed.members,[false,false,true]);
    a.setPrincipal(governor);ok(await a.restore_member(id,member));
    // Restore removes the exclusion marker; it intentionally does not recreate
    // removed role grants. Explicit re-grant supplies the positive ABA control.
    ok(await a.add_role_grant(member,id,'member',[]));a.setPrincipal(identity);
    assert.ok('Err'in await a.read_profile_membership_batch(requester,id,subjects,[removed.revision]),'Remove/restore ABA must not resurrect old revision');
    const restored=ok(await a.read_profile_membership_batch(requester,id,subjects,[]));assert.deepEqual(restored.members,[true,false,true]);
    await pic.upgradeCanister({canisterId:f.canisterId,wasm,sender:governor,arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    assert.deepEqual(ok(await a.read_profile_membership_batch(requester,id,subjects,[restored.revision])),restored,'Membership revision survives upgrade');
    a.setPrincipal(governor);ok(await a.remove_member(id,requester));a.setPrincipal(identity);
    assert.ok('Err'in await a.read_profile_membership_batch(requester,id,subjects,[]),'Removed requester cannot read');
    a.setPrincipal(requester);assert.ok('Err'in await a.read_profile_candidates(id,[]),'Removed requester cannot read candidate identities');
    groups.push(f);
  }
  groups[0].actor.setPrincipal(identity);
  assert.ok('Err'in await groups[0].actor.read_profile_membership_batch(requester,'club-b',[member],[]),'Other-group location grants nothing');
  // Disabling the privacy gate refuses reads without deleting membership.
  await pic.updateCanisterSettings({canisterId:groups[1].canisterId,sender:governor,environmentVariables:[]});
  assert.ok('Err'in await groups[1].actor.read_profile_membership_batch(requester,'club-b',[member],[]));
  // A large source spans bounded pages, not one full private directory read.
  const f=groups[0],a=f.actor;a.setPrincipal(governor);
  ok(await a.restore_member('club-a',requester));
  const many=Array.from({length:251},(_,n)=>Principal.fromUint8Array(Uint8Array.from([n%256,Math.floor(n/256)+9,1])));
  ok(await a.replace_acl(2n,{clubs:['club-a'],teams:[],children:[],guardians:[],exclusions:[],roles:[{user:requester,role:'member',club:['club-a'],team:[]},...many.map(user=>({user,role:'member',club:['club-a'],team:[]}))]}));
  a.setPrincipal(requester);let cursor=[],seen=new Set(),pages=0,revision;
  do {
    const page=ok(await a.read_profile_candidates('club-a',cursor));
    assert.ok(page.scanned<=100n && page.subjects.length<=25);
    if(revision!==undefined)assert.equal(page.revision,revision);revision=page.revision;
    for(const p of page.subjects)seen.add(p.toText());cursor=page.next;pages++;
    assert.ok(pages<=20);
  }while(cursor.length);
  assert.equal(seen.size,252);assert.ok(pages>1);
  console.log('PASS: two real club authorities; service-only delegation, exact club, bounded candidates, family membership, removal, ABA revision rejection, upgrade preservation and closed release gate. No live changes.');
} finally {await pic?.tearDown();await server.stop();}