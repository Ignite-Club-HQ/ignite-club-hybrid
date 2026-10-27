import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPrivateNameClubInventory, prepareInventoriedPrivateNameArtifact, createClubInventoryActors } from './private-name-club-inventory.mjs';
const args = () => ({identityId:'identity',operator:'governor',deploymentHash:'a'.repeat(64),historyRevision:'9007199254740993',sources:[{group:'g1',canisterId:'source-1'},{group:'g2',canisterId:'source-2'}],accounts:[{accountId:'a1',subject:'person-1',name:'Paul',sink:'pii-1'},{accountId:'a2',subject:'person-2',name:'Other',sink:'pii-1'}]});
function setup() {
  const inputs=args(); let reads=0;
  const actor=(club)=>({read_membership_source_page:async()=>{reads++;return {Ok:{revision:8n,scanned:2n,edges:[{Club:{id:club,deleted:false}},{Role:{subject:'outsider',club:[club]}}],next:[]}};},read_membership_discovery_status:async()=>({Ok:{revision:8n}}),read_has_club_membership:async(subject)=>subject==='person-1'});
  const deps={actors:new Map([['source-1',actor('club-1')],['source-2',actor('club-2')]]),assertFence:async()=>true};
  return {inputs,deps,reads:()=>reads};
}
test('all sources contribute exact memberships using consensus booleans, including empty accounts',async()=>{
  const {inputs,deps}=setup(); const report=await collectPrivateNameClubInventory(inputs,deps);
  assert.deepEqual(report.body.rows,[{accountId:'a1',subject:'person-1',clubs:['club-1','club-2']},{accountId:'a2',subject:'person-2',clubs:[]}]);
  assert.equal(report.calls,8); assert.equal(report.body.historyRevision,'9007199254740993');
});
test('no source read starts without authenticated complete fence',async()=>{
  const {inputs,deps,reads}=setup();deps.assertFence=async()=>false;
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/external fence required/);assert.equal(reads(),0);
});
test('revoked fence after a reply withholds the entire result',async()=>{
  const {inputs,deps}=setup();let checks=0;deps.assertFence=async()=>++checks!==4;
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/fence changed/);
});
test('source errors are not empty memberships',async()=>{
  const {inputs,deps}=setup();deps.actors.get('source-2').read_membership_source_page=async()=>({Err:'denied'});
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/source refused/);
});
test('empty filtered source pages continue until exact terminal cursor',async()=>{
  const {inputs,deps}=setup();let pages=0;
  deps.actors.get('source-1').read_membership_source_page=async(cursor)=>{
    pages++;return cursor.length ? {Ok:{revision:8n,scanned:1n,edges:[{Club:{id:'club-1',deleted:false}}],next:[]}} : {Ok:{revision:8n,scanned:100n,edges:[],next:[{revision:8n,phase:1n,offset:1n,nested:0n}]}};
  };
  assert.equal((await collectPrivateNameClubInventory(inputs,deps)).body.rows[0].clubs.length,2);assert.equal(pages,2);
});
test('replayed and drifted source cursors cannot certify completion',async()=>{
  for(const drift of [false,true]){
    const {inputs,deps}=setup();let pages=0;
    deps.actors.get('source-1').read_membership_source_page=async()=>({Ok:{revision:drift && ++pages>1 ? 9n : 8n,scanned:1n,edges:[],next:[{revision:8n,phase:0n,offset:1n,nested:0n}]}});
    await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/revision changed|no progress/);
  }
});
test('deleted clubs are not queried and role edges cannot create membership',async()=>{
  const {inputs,deps}=setup();const actor=deps.actors.get('source-1');let queried=0;
  actor.read_membership_source_page=async()=>({Ok:{revision:8n,scanned:1n,edges:[{Club:{id:'club-1',deleted:true}}],next:[]}});
  actor.read_has_club_membership=async()=>{queried++;return true;};
  assert.deepEqual((await collectPrivateNameClubInventory(inputs,deps)).body.rows[0].clubs,['club-2']);assert.equal(queried,0);
});
test('duplicate sources and conflicting club locations stop the inventory',async()=>{
  const {inputs,deps}=setup();inputs.sources.push(inputs.sources[0]);
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/Distinct/);
  const other=setup();other.deps.actors.set('source-2',other.deps.actors.get('source-1'));
  await assert.rejects(collectPrivateNameClubInventory(other.inputs,other.deps),/ownership/);
});
test('subject ambiguity and missing actors are refused before reads',async()=>{
  const {inputs,deps,reads}=setup();inputs.accounts[1].subject=inputs.accounts[0].subject;
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/Unambiguous/);assert.equal(reads(),0);
  const other=setup();other.deps.actors.delete('source-2');await assert.rejects(collectPrivateNameClubInventory(other.inputs,other.deps),/actors required/);assert.equal(other.reads(),0);
});
test('membership query failures and non-boolean replies stop rather than omit accounts',async()=>{
  for(const reply of [async()=>{throw Error('denied');},async()=>({Ok:false})]){
    const {inputs,deps}=setup();deps.actors.get('source-1').read_has_club_membership=reply;
    await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/denied|Consensus/);
  }
});
test('source revision changes during membership checks invalidate the result',async()=>{
  const {inputs,deps}=setup();deps.actors.get('source-1').read_membership_discovery_status=async()=>({Ok:{revision:9n}});
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/revision changed/);
});
test('global call and club bounds refuse incomplete results',async()=>{
  const {inputs,deps}=setup();await assert.rejects(collectPrivateNameClubInventory({...inputs,maxCalls:2},deps),/call budget/);
  await assert.rejects(collectPrivateNameClubInventory({...inputs,maxClubs:1},deps),/Club inventory budget/);
});
test('artifact composition discards supplied clubs and binds verified source inventory',async()=>{
  const {inputs,deps}=setup();inputs.accounts[0].clubs=['foreign'];inputs.sinks=[{id:'pii-1',publicKey:[1]}];
  const result=await prepareInventoriedPrivateNameArtifact(inputs,{...deps,encryptName:async()=>[2],encryptClubName:async()=>[3]});
  assert.deepEqual(result.artifact.body.rows[0].clubs.map(c=>c.id),['club-1','club-2']);
  assert.equal(result.artifact.body.inventoryHash,result.inventory.hash);assert.equal(JSON.stringify(result.artifact).includes('Paul'),false);
});
test('fence drift during encryption prevents artifact publication',async()=>{
  const {inputs,deps}=setup();inputs.sinks=[{id:'pii-1',publicKey:[1]}];let live=true;
  await assert.rejects(prepareInventoriedPrivateNameArtifact(inputs,{...deps,assertFence:async()=>live,encryptName:async()=>{live=false;return [2];},encryptClubName:async()=>[3]}),/during encryption/);
});
test('generated consensus actor factory constructs actors without calling the network',async()=>{
  const {createRequire}=await import('node:module');const require=createRequire(new URL('../frontend/package.json',import.meta.url));
  const {HttpAgent}=require('@icp-sdk/core/agent');
  const actors=await createClubInventoryActors(new HttpAgent({host:'https://ic0.app'}),[{group:'g1',canisterId:'rkp4c-7iaaa-aaaaa-aaaca-cai'}]);
  const actor=actors.values().next().value;
  assert.equal(typeof actor.read_membership_source_page,'function');assert.equal(typeof actor.read_has_club_membership,'function');
  assert.throws(()=>actor.read_has_club_membership('invalid-principal','club'),/Principal|principal/);
});

test('caller mutation during a held source read cannot change accounts or group coverage',async()=>{
  const {inputs,deps}=setup(); const original=deps.actors.get('source-1').read_membership_source_page;
  deps.actors.get('source-1').read_membership_source_page=async(cursor)=>{
    inputs.accounts[0].subject='outsider'; inputs.sources.pop();
    return original(cursor);
  };
  const report=await collectPrivateNameClubInventory(inputs,deps);
  assert.equal(report.body.rows[0].subject,'person-1');assert.equal(report.body.sources.length,2);assert.deepEqual(report.body.rows[0].clubs,['club-1','club-2']);
});
test('unknown source edge variants never certify a silently incomplete inventory',async()=>{
  const {inputs,deps}=setup();deps.actors.get('source-1').read_membership_source_page=async()=>({Ok:{revision:8n,scanned:1n,edges:[{NewMembership:{}}],next:[]}});
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/Malformed/);
});

test('fence verification receives exact account subjects without plaintext names',async()=>{
  const {inputs,deps}=setup(); let checks=0;
  deps.assertFence=async(context)=>{
    checks++;assert.deepEqual(context.accounts,[{accountId:'a1',subject:'person-1'},{accountId:'a2',subject:'person-2'}]);assert.equal(JSON.stringify(context).includes('Paul'),false);return true;
  };
  await collectPrivateNameClubInventory(inputs,deps);assert.equal(checks,17);
});
test('per-source scan budget refuses oversized traversals even within call budget',async()=>{
  const {inputs,deps}=setup();let offset=0n;
  deps.actors.get('source-1').read_membership_source_page=async()=>({Ok:{revision:8n,scanned:100n,edges:[],next:[{revision:8n,phase:0n,offset:++offset,nested:0n}]}});
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/scan budget/);
});

const completeAccount=a=>({...a,principals:[a.subject,`${a.subject}-alias`],status:'Suspended',version:'9007199254740993',profilePresent:true,sourceDigest:Array(32).fill(7)});
test('membership on a nonfirst alias survives and every alias is checked without short circuit',async()=>{
  const {inputs,deps}=setup();inputs.accounts=inputs.accounts.map(completeAccount);const seen=[];
  for(const actor of deps.actors.values())actor.read_has_club_membership=async(subject,club)=>{seen.push([subject,club]);return subject==='person-1-alias';};
  const result=await collectPrivateNameClubInventory(inputs,deps);
  assert.deepEqual(result.body.rows[0].clubs,['club-1','club-2']);assert.deepEqual(result.body.rows[1].clubs,[]);assert.equal(seen.length,8);assert.equal(result.calls,12);
  assert.equal(result.body.accounts[0].version,'9007199254740993');assert.equal(result.body.accounts[0].status,'Suspended');assert.deepEqual(result.body.accounts[0].principals,['person-1','person-1-alias']);assert.equal(JSON.stringify(result.body).includes('Paul'),false);
});
test('failed second alias read blocks inventory even when first alias is a member',async()=>{
  const {inputs,deps}=setup();inputs.accounts=inputs.accounts.map(completeAccount);
  deps.actors.get('source-1').read_has_club_membership=async subject=>{if(subject.endsWith('-alias'))throw Error('alias denied');return true;};
  await assert.rejects(collectPrivateNameClubInventory(inputs,deps),/alias denied/);
});
test('alias overlap and missing account metadata refuse before source reads',async()=>{
  for(const mutate of [a=>{a[1].principals.push(a[0].subject);},a=>{delete a[0].version;},a=>{delete a[0].status;},a=>{a[0].principals=['foreign'];}]){
    const {inputs,deps,reads}=setup();inputs.accounts=inputs.accounts.map(completeAccount);mutate(inputs.accounts);await assert.rejects(collectPrivateNameClubInventory(inputs,deps));assert.equal(reads(),0);
  }
});
test('encryption fence and inventory hash retain full alias metadata without plaintext',async()=>{
  const {inputs,deps}=setup();inputs.accounts=inputs.accounts.map(completeAccount);inputs.sinks=[{id:'pii-1',publicKey:[1]}];
  const contexts=[];deps.assertFence=async context=>{contexts.push(context);return true;};
  const result=await prepareInventoriedPrivateNameArtifact(inputs,{...deps,encryptName:async()=>[2],encryptClubName:async()=>[3]});
  assert.deepEqual(contexts.at(-1).accounts,result.inventory.body.accounts);assert.equal(result.artifact.body.inventoryHash,result.inventory.hash);
});