import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateNameCoordinatorAdapter,createPrivateNameProfileAdapter,createPrivateNamePiiAdapter,createApprovedNameWriteAdapter,createApprovedNameCoordinatorAdapter} from './private-name-canister-adapters.mjs';
const p=text=>({toText:()=>text});
const window={phase:{Fencing:null},sinks:[p('sink')],writers:[p('writer')],opened:[{receiver:p('writer')}],sealed:[],completed:[]};
test('generated coordinator converts principals and preserves revisions above JS safe integer',async()=>{
  let seen;
  const actor={begin_private_name_write_window:async(_id,rev)=>{seen=rev;return {Ok:window};},advance_private_name_write_window:async(_id,target)=>{assert.equal(target.toText(),'sink');return {Ok:window};}};
  const adapter=createPrivateNameCoordinatorAdapter(actor,{fromText:p});const result=await adapter.begin('op','9007199254740993');
  assert.equal(seen,9007199254740993n);assert.equal(result.phase,'Fencing');assert.deepEqual(result.sinks,['sink']);assert.equal(result.opened[0].receiver,'writer');await adapter.advance('op','sink');
  await assert.rejects(adapter.begin('op',9007199254740993),/nat64/);
});
test('refused and unknown coordinator variants never normalize to usable windows',async()=>{
  for(const reply of [{Err:'denied'},{Ok:{...window,phase:{Future:null}}},{Ok:{...window,sinks:[p('2vxsx-fae')]}}]){
    await assert.rejects(createPrivateNameCoordinatorAdapter({read_private_name_write_window:async()=>reply},{fromText:p}).read('op'));
  }
});
test('all profile pages retain all aliases and reject ambiguity, cursor replay and exclusion loss',async()=>{
  const pages=[{rows:[{account_id:'a',display_name:'A',principals:[p('one'),p('two')]}],next:['a']},{rows:[{account_id:'b',display_name:'B',principals:[p('three')]}],next:[]}];let i=0;
  const adapter=createPrivateNameProfileAdapter({list_profiles_for_conversion:async()=>({Ok:pages[i++]})},{assertFence:async()=>true});
  assert.deepEqual((await adapter.listProfiles()).map(r=>r.principals),[['one','two'],['three']]);
  for(const page of [{rows:pages[0].rows,next:['wrong']},{rows:[...pages[0].rows,{account_id:'b',display_name:'B',principals:[p('two')]}],next:[]}]){
    await assert.rejects(createPrivateNameProfileAdapter({list_profiles_for_conversion:async()=>({Ok:page})},{assertFence:async()=>true}).listProfiles());
  }
  let held=true;
  await assert.rejects(createPrivateNameProfileAdapter({list_profiles_for_conversion:async()=>{held=false;return {Ok:pages[1]};}},{assertFence:async()=>held}).listProfiles(),/exclusion/);
});
test('profile inventory errors and page budgets never become empty success',async()=>{
  await assert.rejects(createPrivateNameProfileAdapter({list_profiles_for_conversion:async()=>({Err:'denied'})},{assertFence:async()=>true}).listProfiles(),/refused/);
  await assert.rejects(createPrivateNameProfileAdapter({list_profiles_for_conversion:async()=>({Ok:{rows:[{account_id:'a',display_name:'A',principals:[p('one')]}],next:['a']}})},{assertFence:async()=>true,maxPages:1}).listProfiles(),/budget/);
});
test('PII adapter rejects wrong original fields and preserves exact club ciphertext scheme',async()=>{
  const record={pii_id:'person',field_id:'display_name',ciphertext:Uint8Array.from([4]),master_key_id:'vetkey-club-names-v1:club'};
  const adapter=createPrivateNamePiiAdapter({get_encrypted_pii_batch:async()=>({Ok:[{...record,field_id:'email'}]}),read_private_club_name_preparation:async(subject,club)=>{assert.equal(subject.toText(),'person');assert.equal(club,'club');return {Ok:record};}},{fromText:p});
  await assert.rejects(adapter.readOriginal('person'),/binding/);assert.deepEqual((await adapter.readClub('person','club')).ciphertext,[4]);
});
test('approved writes reject foreign subject/club/reference before transport',async()=>{
  let calls=0;const adapter=createApprovedNameWriteAdapter({write_approved_private_name:async()=>{calls++;return {Ok:null};}},{operationId:`club-name-conversion-${'a'.repeat(64)}`,rows:[{accountId:'a',subject:'person',sink:'pii',clubs:[{id:'club'}]}],assertFence:async()=>true});
  await assert.rejects(adapter.writeOriginal('other'),/row/);await assert.rejects(adapter.writeClub('person','foreign'),/row/);await assert.rejects(adapter.publishReference('a','foreign'),/reference/);assert.equal(calls,0);
  await adapter.writeOriginal('person');await adapter.writeClub('person','club');assert.equal(calls,2);
});
test('backend signed approval refusal prevents any conversion advance',async()=>{
  const actor={begin_private_name_write_window:async()=>({Ok:window}),approve_private_name_conversion:async()=>({Err:'invalid signature'})};
  const adapter=createApprovedNameCoordinatorAdapter(actor,{fromText:p},{loadApproval:async()=>({signature:[]}),assertFence:async()=>true});
  await assert.rejects(adapter.begin('operation','1'),/refused/);
});