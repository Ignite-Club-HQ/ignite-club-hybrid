// Disposable real service writer barriers. No production transport or approvals.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as placementIdl } from '../src/lab/bindings/placement_registry/declarations/placement_registry.did.js';
import { idlFactory as competitionIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as leagueIdl } from '../src/lab/bindings/mini_league_domain/declarations/mini_league_domain.did.js';
import { idlFactory as messagingIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
const root=resolve(import.meta.dirname,'../..');
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=p(1),outsider=p(2);
const ok=r=>{assert.ok('Ok' in r,r.Err);return r.Ok;};
const refused=async fn=>{let denied=false;try {const r=await fn();denied=!!r&&'Err' in r;}catch {denied=true;}assert.ok(denied,'Write must fail closed');};
const wasm=d=>resolve(root,`backend/${d}/.mops/.build/${d}.wasm`);
const server=await PocketIcServer.start({binPath:process.env.POCKET_IC_BIN||'/root/.cache/mops/pocket-ic/15.0.0/pocket-ic'});let pic;
try {
 pic=await PocketIc.create(server.getUrl(),{fiduciary:{state:{type:'new'}}});
 const init=IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}]);
 const identity=await pic.setupCanister({idlFactory:identityIdl,wasm:resolve(root,'target/wasm32-unknown-unknown/release/identity_access.wasm'),sender:governor,controllers:[governor],arg:init});
 identity.actor.setPrincipal(governor);ok(await identity.actor.register_account());
 const env=[{name:'IGNITE_PRIVATE_NAME_WRITER_REHEARSAL',value:'1'},{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()}];
 await pic.updateCanisterSettings({canisterId:identity.canisterId,sender:governor,environmentVariables:env});
 await pic.upgradeCanister({canisterId:identity.canisterId,wasm:resolve(root,'target/wasm32-unknown-unknown/release/identity_access.wasm'),sender:governor,arg:init});
 const writers=[{service:identity,write:()=>identity.actor.set_profile('Private-name coordinator',[])}];
 const groups=[];
 for(let n=0;n<2;n++){
  const group={};
  for(const [d,idlFactory] of [['club_domain',clubIdl],['messaging_domain',messagingIdl],['competition_domain',competitionIdl],['mini_league_domain',leagueIdl],['pii_access_control',piiIdl]]){
   const service=await pic.setupCanister({idlFactory,wasm:wasm(d),sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor]),environmentVariables:[...env,{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL',value:'1'},{name:'IGNITE_PRIVATE_PROFILE_IDENTITY',value:identity.canisterId.toText()},{name:'VETKD_KEY_NAME',value:'key_1'}]});
   service.actor.setPrincipal(governor);group[d]=service;
   writers.push({service,write:d==='club_domain'?()=>service.actor.set_identity_access_canister(identity.canisterId):()=>service.actor.set_club_domain_canister(identity.canisterId)});
  }
  groups.push(group);
 }
 // Topology is deliberately closed throughout this stop-the-world rehearsal.
 for(const [d,idlFactory] of [['shard_router',routerIdl],['placement_registry',placementIdl]]){
  const service=await pic.setupCanister({idlFactory,wasm:resolve(root,`target/wasm32-unknown-unknown/release/${d}.wasm`),sender:governor,controllers:[governor],arg:init,environmentVariables:env});
  service.actor.setPrincipal(governor);
  await refused(()=>d==='shard_router'?service.actor.set_website_default_club_domain(outsider):service.actor.grant_operator(outsider,[]));
  service.actor.setPrincipal(identity.canisterId);
  await refused(()=>service.actor.open_private_name_writer_window({operation_id:'forged-topology-open',generation:1n,inventory_digest:new Uint8Array(32)}));
 }
 const request={operation_id:'names:two-group-window',generation:1n,inventory_digest:new Uint8Array(32).fill(7)};
 const sinks=groups.map(g=>g.pii_access_control);
 for(const w of writers)await refused(w.write);
 for(const sink of sinks){sink.actor.setPrincipal(identity.canisterId);ok(await sink.actor.prepare_private_name_release_fence(request));assert.equal(ok(await sink.actor.read_private_name_release_fence(request)).completed,false);}
 for(const w of writers){w.service.actor.setPrincipal(outsider);await refused(()=>w.service.actor.open_private_name_writer_window(request));w.service.actor.setPrincipal(identity.canisterId);ok(await w.service.actor.open_private_name_writer_window(request));ok(await w.service.actor.open_private_name_writer_window(request));w.service.actor.setPrincipal(outsider);await refused(w.write);w.service.actor.setPrincipal(governor);ok(await w.write());}
 for(const w of writers){w.service.actor.setPrincipal(identity.canisterId);ok(await w.service.actor.seal_private_name_writer_window(request));const r=ok(await w.service.actor.read_private_name_writer_window(request));assert.equal(r.active,0n);assert.equal(r.sealed,true);await refused(()=>w.service.actor.open_private_name_writer_window(request));w.service.actor.setPrincipal(governor);await refused(w.write);}
 for(const sink of sinks){sink.actor.setPrincipal(identity.canisterId);ok(await sink.actor.complete_private_name_release_fence(request));const r=ok(await sink.actor.read_private_name_release_fence(request));assert.equal(r.completed,true);assert.ok(r.release_epoch>1n);}
 // Stable sealed windows and completed sink tombstones survive upgrade.
 const sink=sinks[0];await pic.upgradeCanister({canisterId:sink.canisterId,wasm:wasm('pii_access_control'),sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 sink.actor.setPrincipal(identity.canisterId);assert.equal(ok(await sink.actor.read_private_name_writer_window(request)).sealed,true);assert.equal(ok(await sink.actor.read_private_name_release_fence(request)).completed,true);await refused(()=>sink.actor.open_private_name_writer_window(request));
 console.log('PASS: eleven real writer services across two groups reject closed/forged writes; preserve existing auth in exact windows; seal before PII release; topology remains closed; sealed and completed receipts survive upgrade.');
}finally {if(pic)await pic.tearDown();await server.stop();}
