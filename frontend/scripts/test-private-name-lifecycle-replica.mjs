// Isolated real PII instances and SDK ciphertext; no production target discovery.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {PocketIc,PocketIcServer} from '@dfinity/pic';
import {Principal} from '@icp-sdk/core/principal';
import {IDL} from '@icp-sdk/core/candid';
import {DerivedPublicKey,IbeCiphertext,IbeIdentity,IbeSeed} from '@icp-sdk/vetkeys';
import {idlFactory} from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import {createPrivateNameLifecycleAdapter} from '../../scripts/private-name-canister-adapters.mjs';
import {reconcileNameReplicaLifecycle} from '../../scripts/private-name-replica-lifecycle.mjs';
const root=resolve(import.meta.dirname,'../..'),wasm=resolve(root,'backend/pii_access_control/.mops/.build/pii_access_control.wasm');
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1])),governor=p(1),person=p(2),alias=p(3),outsider=p(4);
const ok=r=>{assert.ok('Ok'in r,r.Err);return r.Ok;};
const server=await PocketIcServer.start();let pic;
try{
  pic=await PocketIc.create(server.getUrl(),{fiduciary:{state:{type:'new'}}});
  const arg=IDL.encode([IDL.Principal],[governor]),services=[],targets=[],encoding=new TextEncoder();
  for(let i=0;i<2;i++){
    const service=await pic.setupCanister({idlFactory,wasm,sender:governor,controllers:[governor],arg,environmentVariables:[{name:'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL',value:'1'},{name:'VETKD_KEY_NAME',value:'key_1'}]});
    service.actor.setPrincipal(governor);services.push(service);
    const key=DerivedPublicKey.deserialize(Uint8Array.from(await service.actor.pii_vetkey_verification_key()));
    for(const subject of [person,alias]){
      const originalCiphertext=Array.from(IbeCiphertext.encrypt(key,IbeIdentity.fromBytes(encoding.encode(`${subject.toText()}\u001fdisplay_name`)),encoding.encode('Personal name'),IbeSeed.random()).serialize());
      ok(await service.actor.register_pii(subject.toText(),'display_name',originalCiphertext,subject));
      ok(await service.actor.register_pii(subject.toText(),'email',[8,9],subject));
      for(const club of ['club-one','club-two']){
        const ciphertext=Array.from(IbeCiphertext.encrypt(key,IbeIdentity.fromBytes(encoding.encode(`clubnames:${club}\u001fdisplay_name`)),encoding.encode('Personal name'),IbeSeed.random()).serialize());
        targets.push({sink:service.canisterId.toText(),subject:subject.toText(),club,ciphertext,originalCiphertext});
      }
    }
  }
  const actors=new Map(services.map(s=>[s.canisterId.toText(),s.actor]));
  const adapter=createPrivateNameLifecycleAdapter({targets,actors,Principal,assertFence:async()=>true});
  let journal=null;
  const deps={...adapter,assertEvidence:async()=>true,readJournal:async()=>structuredClone(journal),persistJournal:async j=>{journal=structuredClone(j);}};
  assert.deepEqual(await reconcileNameReplicaLifecycle({operationId:'local-name-refresh',action:'refresh',targets},deps),{completed:8,action:'refresh'});
  const selected=targets[0],actor=actors.get(selected.sink);
  assert.ok(actor);
  actor.setPrincipal(outsider);assert.ok('Err'in await actor.read_private_club_name_lifecycle(person,'club-one',[]));assert.ok('Err'in await actor.purge_private_club_name_lifecycle(person,'club-one',selected.ciphertext));actor.setPrincipal(governor);
  assert.ok('Err'in await actor.purge_private_club_name_lifecycle(person,'club-one',[9]));
  assert.ok('Err'in await actor.refresh_private_club_name_lifecycle(person,'club-one',[9],selected.ciphertext));
  assert.ok('Err'in await actor.refresh_private_club_name_lifecycle(person,'club-one',selected.originalCiphertext,[9]));
  // Eight distinct targets include the same subject in two original sinks.
  // Lose a COMMITTED purge reply, upgrade its receiver, then resume by absence.
  const purgeTargets=targets.map(({originalCiphertext,...t})=>t);
  const purgeAdapter=createPrivateNameLifecycleAdapter({targets:purgeTargets,actors,Principal,assertFence:async()=>true});
  journal=null;let calls=0,lost=true;
  const purgeDeps={...deps,...purgeAdapter,purgeExactReplica:async t=>{calls++;await purgeAdapter.purgeExactReplica(t);if(lost){lost=false;throw Error('lost committed purge reply');}}};
  const purgePlan={operationId:'local-name-purge',action:'purge',targets:purgeTargets};
  await assert.rejects(reconcileNameReplicaLifecycle(purgePlan,purgeDeps),/lost committed/);
  assert.equal(journal.receipts[0].phase,'unknown');assert.equal(calls,1);
  await pic.upgradeCanister({canisterId:services[0].canisterId,wasm,sender:governor,arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  assert.deepEqual(await reconcileNameReplicaLifecycle(purgePlan,purgeDeps),{completed:8,action:'purge'});assert.equal(calls,8);
  for(const s of services){s.actor.setPrincipal(governor);assert.equal(ok(await s.actor.get_encrypted_pii_batch([person.toText(),alias.toText()],'display_name','read','lifecycle acceptance')).length,2);assert.equal(ok(await s.actor.get_encrypted_pii_batch([person.toText(),alias.toText()],'email','read','lifecycle acceptance')).length,2);}
  // A replacement removes only its own local replicas; stale original bytes
  // cannot regenerate a club copy after the original has changed.
  ok(await actor.refresh_private_club_name_lifecycle(person,'club-one',selected.originalCiphertext,selected.ciphertext));
  ok(await actor.register_pii(person.toText(),'display_name',[7,7],person));
  assert.deepEqual(ok(await actor.read_private_club_name_lifecycle(person,'club-one',[])),[]);
  assert.ok('Err'in await actor.read_private_club_name_lifecycle(person,'club-one',[selected.originalCiphertext]));
  assert.ok('Err'in await actor.refresh_private_club_name_lifecycle(person,'club-one',selected.originalCiphertext,selected.ciphertext));
  const disabled=await pic.setupCanister({idlFactory,wasm,sender:governor,controllers:[governor],arg,environmentVariables:[{name:'VETKD_KEY_NAME',value:'key_1'}]});disabled.actor.setPrincipal(governor);
  assert.ok('Err'in await disabled.actor.read_private_club_name_lifecycle(person,'club-one',[]));
  assert.ok('Err'in await disabled.actor.refresh_private_club_name_lifecycle(person,'club-one',selected.originalCiphertext,selected.ciphertext));
  assert.ok('Err'in await disabled.actor.purge_private_club_name_lifecycle(person,'club-one',selected.ciphertext));
  console.log('PASS: two original PII sinks, two aliases and two clubs; eight saved ciphertext refreshes/purges; committed lost reply resolves after upgrade without replay; originals/emails retained; stale original/conflicting purge/outsiders denied; production-disabled methods refuse. Explicit fixture coverage is not live inventory or exclusion proof.');
}finally{await pic?.tearDown();await server.stop();}