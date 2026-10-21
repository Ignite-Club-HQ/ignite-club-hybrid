// Real local actors, always-eligible delayed authority. Never production flags
// or evidence for opening: proves receiver fences independent of account deletion.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
const principal=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=principal(1), removed=principal(2), survivor=principal(3);
const requestType=IDL.Record({account_id:IDL.Text,generation:IDL.Nat64,inventory_digest:IDL.Vec(IDL.Nat8),subjects:IDL.Vec(IDL.Principal)});
const receipt=IDL.Record({request:requestType,receiver:IDL.Principal,outstanding:IDL.Nat});
const relayIdl=({IDL:I})=>I.Service({
  hold_admission:I.Func([],[],[]),release_admission:I.Func([],[],[]),admission_progress:I.Func([],[I.Nat,I.Bool],['query']),
  prepare:I.Func([I.Principal,requestType],[I.Variant({Ok:I.Null,Err:I.Text})],[]),
  drain:I.Func([I.Principal,requestType],[I.Variant({Ok:receipt,Err:I.Text})],[]),
  seal:I.Func([I.Principal,requestType],[I.Variant({Ok:receipt,Err:I.Text})],[]),
});
const ok=r=>{assert.ok('Ok' in r,String(r.Err));return r.Ok};
const probes={
  events_domain:['read_account_list_my_viewed_event_ids',[[]]],
  competition_domain:['read_account_list_competitions',['club']],
  mini_league_domain:['read_account_get_mini_leagues',[[]]],
  club_points_domain:['read_account_get_user_points',['club',removed.toText()]],
  media_metadata:['read_account_get_asset',['unknown']],
  insights_domain:['record_web_vital',['LCP',12,'good','/receiver']],
  notification_queue:['read_account_get_push_alert_settings',[]],
};
const server=await PocketIcServer.start();let pic;
try{
 pic=await PocketIc.create(server.getUrl());
 assert.ok(process.env.REMOVAL_RELAY_WASM,'Real relay Wasm required');
 const relay=await pic.setupCanister({idlFactory:relayIdl,wasm:process.env.REMOVAL_RELAY_WASM,sender:governor,controllers:[governor]});
 for(const [domain,[method,args]] of Object.entries(probes)){
  assert.ok(process.env[domain.toUpperCase()+'_WASM'],domain+' real Wasm required');
  const {idlFactory}=await import(`../src/lab/bindings/${domain}/declarations/${domain}.did.js`);
  const service=await pic.setupCanister({idlFactory,wasm:process.env[domain.toUpperCase()+'_WASM'],sender:governor,controllers:[governor],
   environmentVariables:[{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:relay.canisterId.toText()}],arg:IDL.encode([IDL.Principal],[governor])});
  const signature=idlFactory({IDL})._fields.find(([n])=>n===method)?.[1];assert.ok(signature,domain+' real method');
  service.actor.setPrincipal(removed);await service.actor[method](...args); // positive, no hold
  const request={account_id:'removed-'+domain,generation:9n,inventory_digest:new Uint8Array(32).fill(9),subjects:[removed]};
  await relay.actor.hold_admission();
  const pending=await pic.client.submitCall({canisterId:service.canisterId,sender:removed,method,payload:new Uint8Array(IDL.encode(signature.argTypes,args))});
  let observed=false;
  for(let round=0;round<80;round++){await pic.tick(1);const [count,held]=await relay.actor.admission_progress();if(count>0n&&held){observed=true;break}}
  assert.ok(observed,domain+' actually reached admission callback');
  ok(await relay.actor.prepare(service.canisterId,request));
  assert.ok(ok(await relay.actor.drain(service.canisterId,request)).outstanding>0n,domain+' held operation cannot drain');
  assert.ok('Err' in await relay.actor.seal(service.canisterId,request),domain+' cannot seal held work');
  await relay.actor.release_admission();
  await assert.rejects(()=>pic.client.awaitCall(pending),undefined,domain+' late eligible reply must be denied');
  assert.equal(ok(await relay.actor.seal(service.canisterId,request)).outstanding,0n);
  await pic.upgradeCanister({canisterId:service.canisterId,wasm:process.env[domain.toUpperCase()+'_WASM'],sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  service.actor.setPrincipal(removed);await assert.rejects(()=>service.actor[method](...args));
  service.actor.setPrincipal(survivor);await service.actor[method](...args);
  assert.equal(ok(await relay.actor.seal(service.canisterId,request)).outstanding,0n);
  service.actor.setPrincipal(governor);assert.ok('err' in await service.actor.rekey_principal(removed,survivor,false));
  console.log('PASS',domain,'observed held admission, late eligible denial, fresh seal, upgrade fence, survivor access');
 }
}finally{if(pic)await pic.tearDown();await server.stop()}