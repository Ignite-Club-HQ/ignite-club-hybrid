import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateNameCoordinatorAdapter,createPrivateNameProfileAdapter,createPrivateNamePiiAdapter,createApprovedNameWriteAdapter,createApprovedNameCoordinatorAdapter,createPrivateNameAccountInventoryAdapter,createPrivateNamePreparationAdapter} from './private-name-canister-adapters.mjs';
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

const accountRequest={operation_id:'names:club-name-conversion-test',generation:9007199254740993n,inventory_digest:Array(32).fill(4)};
const accountRow=(id='a')=>({account:{id,principals:[p(`${id}-one`),p(`${id}-two`)],version:9007199254740993n,status:{Suspended:null}},profile:[],original_authority:{NoName:null},source_digest:Array(32).fill(7)});
const accountPage=(rows,next,scanned=rows.length)=>({request:accountRequest,revision:9007199254740994n,scanned,rows,next});
const accountAdapter=pages=>{let calls=0;return {adapter:createPrivateNameAccountInventoryAdapter({read_private_name_account_inventory:async()=>({Ok:pages[calls++]})},{operationId:'club-name-conversion-test',request:accountRequest,assertFence:async()=>true}),calls:()=>calls};};
test('account-first evidence retains profileless suspended accounts and all aliases through profile validation',async()=>{
  const {adapter,calls}=accountAdapter([accountPage([accountRow()], [{phase:1,after:[],revision:9007199254740994n}]),accountPage([],[],0)]);
  const result=await adapter.listAccounts();assert.equal(calls(),2);assert.equal(result.revision,'9007199254740994');assert.equal(result.rows[0].version,'9007199254740993');assert.equal(result.rows[0].status,'Suspended');assert.equal(result.rows[0].profile,null);assert.deepEqual(result.rows[0].principals,['a-one','a-two']);
});
test('account inventory requires integrity terminal pass and refuses revision or request drift',async()=>{
  for(const pages of [[accountPage([accountRow()],[])],[accountPage([accountRow()],[{phase:1,after:[],revision:9007199254740994n}]),{...accountPage([],[],0),revision:9007199254740995n}],[{...accountPage([],[],0),request:{...accountRequest,generation:1n}}]])await assert.rejects(accountAdapter(pages).adapter.listAccounts());
});
test('dangling profile refusal and exclusion loss cannot return partial accounts',async()=>{
  let calls=0,held=true;const actor={read_private_name_account_inventory:async()=>{calls++;if(calls===1)return {Ok:accountPage([accountRow()],[{phase:1,after:[],revision:9007199254740994n}])};return {Err:'dangling profile'};}};
  await assert.rejects(createPrivateNameAccountInventoryAdapter(actor,{operationId:'club-name-conversion-test',request:accountRequest,assertFence:async()=>held}).listAccounts(),/refused/);
  actor.read_private_name_account_inventory=async()=>{held=false;return {Ok:accountPage([accountRow()],[])};};
  await assert.rejects(createPrivateNameAccountInventoryAdapter(actor,{operationId:'club-name-conversion-test',request:accountRequest,assertFence:async()=>held}).listAccounts(),/exclusion/);
});
test('original name evidence preserves nonfirst subject and refuses mismatched reference',async()=>{
  const r=accountRow();r.profile=[{account_id:'a',display_name:'pii-display-name:v1:sink:a-two'}];r.original_authority={Existing:{sink:p('sink'),subject:p('a-two')}};
  const pages=[accountPage([r],[{phase:1,after:[],revision:9007199254740994n}]),accountPage([],[],0)];
  assert.deepEqual((await accountAdapter(pages).adapter.listAccounts()).rows[0].originalAuthority,{kind:'Existing',sink:'sink',subject:'a-two'});
  r.profile[0].display_name='pii-display-name:v1:sink:foreign';await assert.rejects(accountAdapter(pages).adapter.listAccounts(),/authority/);
});
test('ambiguous aliases across account pages stop complete inventory',async()=>{
  const b=accountRow('b');b.account.principals=[p('a-one')];await assert.rejects(accountAdapter([accountPage([accountRow(),b],[])]).adapter.listAccounts(),/alias/);
});
test('committed generated actor exposes consensus account inventory and lossless evidence wire types',async()=>{
  const {createRequire}=await import('node:module');const require=createRequire(new URL('../frontend/package.json',import.meta.url));
  const {Actor,HttpAgent}=require('@icp-sdk/core/agent');const {IDL}=require('@icp-sdk/core/candid');const {Principal}=require('@icp-sdk/core/principal');
  const {idlFactory}=await import('../frontend/src/lab/bindings/identity_access/declarations/identity_access.did.js');
  const actor=Actor.createActor(idlFactory,{agent:new HttpAgent({host:'https://ic0.app'}),canisterId:'rkp4c-7iaaa-aaaaa-aaaca-cai'});assert.equal(typeof actor.read_private_name_account_inventory,'function');
  const fn=new Map(idlFactory({IDL})._fields).get('read_private_name_account_inventory');assert.deepEqual(fn.annotations,[]);
  const owner=Principal.fromUint8Array(Uint8Array.from([3,1]));const r=accountRow();r.account.principals=[owner];
  const encoded=IDL.encode(fn.retTypes,[{Ok:accountPage([r],[],1)}]);const decoded=IDL.decode(fn.retTypes,encoded)[0].Ok;
  assert.equal(decoded.rows[0].account.version,9007199254740993n);assert.deepEqual(decoded.rows[0].profile,[]);assert.ok('Suspended' in decoded.rows[0].account.status);
});
test('preparation adapter preserves unsigned waiting stages and stops when external coverage changes',async()=>{
  let calls=0,held=true;const actor={begin_private_name_preparation:async()=>{calls++;return {Ok:{...window,phase:{Preparing:null}}};},advance_private_name_preparation:async()=>({Ok:{...window,phase:{AwaitingApproval:null}}}),verify_private_name_preparation:async()=>({Ok:window})};
  const adapter=createPrivateNamePreparationAdapter(actor,{fromText:p},{assertFence:async()=>held});assert.equal((await adapter.begin('club-name-preparation-owner','1',{})).phase,'Preparing');assert.equal((await adapter.advance('op','writer')).phase,'AwaitingApproval');held=false;await assert.rejects(adapter.begin('op','1',{}),/coverage/);assert.equal(calls,1);
});