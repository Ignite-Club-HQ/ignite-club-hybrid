// Disposable actors and a test identity authority. No mainnet or provider calls.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as compIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as queueIdl } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const gov=p(1), manager=p(2), alias=p(3), other=p(4);
const ok=r=>{assert.ok('Ok' in r,r.Err);return r.Ok;};
const denied=r=>assert.ok('Err' in r);
const server=await PocketIcServer.start();let pic;
try {
  pic=await PocketIc.create(server.getUrl());
  const identity=await pic.setupCanister({idlFactory:()=>IDL.Service({}),wasm:process.env.BROADCAST_IDENTITY_WASM,sender:gov,controllers:[gov],arg:IDL.encode([IDL.Principal,IDL.Principal],[manager,alias])});
  const setup=(idlFactory,wasm)=>pic.setupCanister({idlFactory,wasm,sender:gov,controllers:[gov],arg:IDL.encode([IDL.Principal],[gov]),environmentVariables:[{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()},{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]});
  const C=await setup(clubIdl,process.env.CLUB_DOMAIN_WASM),K=await setup(compIdl,process.env.COMPETITION_DOMAIN_WASM),Q=await setup(queueIdl,process.env.NOTIFICATION_QUEUE_WASM);
  const c=C.actor,k=K.actor,q=Q.actor;
  for(const a of [c,k,q])a.setPrincipal(gov);
  ok(await c.set_identity_access_canister(identity.canisterId));ok(await q.set_identity_access_canister(identity.canisterId));
  ok(await c.create_club('club','Club','club',[],[]));ok(await c.add_role_grant(manager,'club','club_admin',[]));
  ok(await c.add_role_grant(alias,'club','club_admin',[]));ok(await c.add_role_grant(other,'club','club_admin',[]));
  ok(await c.set_competition_authorities([K.canisterId]));ok(await k.set_club_domain_canister(C.canisterId));
  ok(await c.set_notification_queue_canister(Q.canisterId));ok(await q.set_club_domain_canister(C.canisterId));
  k.setPrincipal(manager);const competition=ok(await k.create_competition('club','Cup','2026')).id;
  k.setPrincipal(gov);ok(await k.grant_role(manager,'competition_admin',competition,[]));ok(await k.grant_role(alias,'referee',competition,[]));ok(await k.grant_role(other,'referee',competition,[]));k.setPrincipal(manager);
  assert.ok(ok(await k.queue_competition_broadcast('op',competition,[],'Notice','Body'))>0n);
  // Exact live queue/relay proof is retained until retirement, including count.
  q.setPrincipal(C.canisterId);const proof=ok(await q.read_competition_broadcast_receipt('club',`bc-${competition}-1`))[0];assert.ok(proof);
  q.setPrincipal(other);denied(await q.retire_competition_broadcast('club',`bc-${competition}-1`,proof.audience,proof.count));
  q.setPrincipal(gov);const pending=ok(await q.claim(9999999999999n,100));assert.ok(pending.length>0);
  for(const a of [c,k,q])a.setPrincipal(manager);
  ok(await k.prepare_my_broadcast_erasure());ok(await c.prepare_my_broadcast_erasure());ok(await q.prepare_my_broadcast_erasure());
  ok(await k.check_my_broadcast_erasure());denied(await c.purge_my_broadcast_data());denied(await q.purge_my_data());
  q.setPrincipal(gov);for(const n of pending)ok(await q.acknowledge(n.id,n.idempotency_key));
  c.setPrincipal(manager);ok(await c.purge_my_broadcast_data());ok(await c.purge_my_broadcast_data());
  q.setPrincipal(manager);ok(await q.purge_my_data());ok(await q.purge_my_data());
  q.setPrincipal(alias);assert.equal(ok(await q.list_inbox(alias.toText(),[],100)).length,0);
  q.setPrincipal(C.canisterId);denied(await q.enqueue_competition_broadcast(proof.audience,'club',competition,'Body',`bc-${competition}-1`));
  q.setPrincipal(manager);
  q.setPrincipal(other);const inbox=ok(await q.list_inbox(other.toText(),[],100));assert.ok(inbox.length>0);assert.ok(inbox.every(n=>n.user===other.toText()));
  k.setPrincipal(manager);ok(await k.purge_my_data());denied(await k.queue_competition_broadcast('op',competition,[],'Notice','Body'));
  k.setPrincipal(alias);denied(await k.queue_competition_broadcast('new-op',competition,[],'Notice','Body'));
  for(const [f,wasm] of [[C,process.env.CLUB_DOMAIN_WASM],[K,process.env.COMPETITION_DOMAIN_WASM],[Q,process.env.NOTIFICATION_QUEUE_WASM]])await pic.upgradeCanister({canisterId:f.canisterId,sender:gov,wasm,arg:IDL.encode([IDL.Principal],[gov]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  c.setPrincipal(manager);ok(await c.purge_my_broadcast_data());k.setPrincipal(manager);denied(await k.queue_competition_broadcast('op',competition,[],'Notice','Body'));
  q.setPrincipal(manager);ok(await q.purge_my_data());
  console.log('PASS: processing refusal, original relay retirement, alias cleanup, unrelated recipient preservation, retry and upgrade replay barriers.');
}finally{if(pic)await pic.tearDown();await server.stop();}