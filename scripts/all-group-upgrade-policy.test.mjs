import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planInventory, SCOPES, PRIMARY_SUBNET, validateRequest, installArgs, digest, assertCheckedPlan, validateJournal, requireSettledPredecessor, executeUpgrades } from './all-group-upgrade-policy.mjs';
import { GROUP_BUILD_SERVICES } from './stage-group-wasm.mjs';
const shared=JSON.parse(readFileSync(new URL('../deploy/mainnet/.icp/data/mappings/ic.ids.json',import.meta.url)));
const original=JSON.parse(readFileSync(new URL('../deploy/groups/g2/provision.json',import.meta.url)));
const hash=n=>String(n).repeat(64);
const p=id=>({toText:()=>id});
function fixture(count=2){
  const provisions=Array.from({length:count-1},(_,i)=>{
    const provision=structuredClone(original), id=`g${i+2}`;
    provision.groupId=id;
    if(i){for(const name of Object.keys(provision.canisters))provision.canisters[name]=`${id}-${name.replaceAll('_','')}-cai`;provision.dedicatedBlobStore.canisterId=`${id}-store-cai`;}
    return provision;
  });
  const groups=provisions.map(provision=>({id:provision.groupId,target_alias:'mainnet',domains:[...Object.entries(provision.canisters),['secret_workload_identity',shared.secret_workload_identity]].map(([domain,id])=>({domain,canister:p(id)})),photo_store:[p(provision.dedicatedBlobStore.canisterId)]}));
  const placements=groups.map(g=>({group_id:g.id,deployment_id:'mainnet',host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:p(PRIMARY_SUBNET),approved_subnets:[p(PRIMARY_SUBNET)],additional_subnets_enabled:false,domains:g.domains.map(d=>({...d,subnet:p(PRIMARY_SUBNET)}))}));
  return {provisions,registry:{groups,placements,configurationRevision:2n},hashes:Object.fromEntries(Object.values(SCOPES).flat().map(n=>[n,hash(2)]))};
}
test('upgrade requires exact all-group confirmation and checked plan hash',()=>{
  validateRequest('check','app_admin');validateRequest('upgrade','app_admin',' UPGRADE ALL MAINNET GROUPS\n',hash(1));
  for(const args of [['upgrade','app_admin','UPGRADE GROUP 2',hash(1)],['upgrade','app_admin','UPGRADE ALL MAINNET GROUPS',''],['check','arbitrary'],['reload','full_backend']])assert.throws(()=>validateRequest(...args));
});
test('includes Group 1 and Group 2 and upgrades shared identity exactly once',()=>{
  const f=fixture();const plan=planInventory(shared,f.provisions,f.registry,'app_admin',f.hashes);
  assert.deepEqual(plan.groups.map(g=>g.id),['g1','g2']);
  assert.equal(plan.targets.length,3);assert.equal(plan.targets.filter(t=>t.name==='identity_access').length,1);
  assert.equal(plan.targets.find(t=>t.groupId==='g2').canisterId,original.canisters.notification_queue);
});
test('future Group 3 and Group 4 cannot be silently skipped',()=>{
  const f=fixture(4),plan=planInventory(shared,f.provisions,f.registry,'messaging',f.hashes);
  assert.deepEqual(plan.targets.map(t=>t.groupId),['g1','g2','g3','g4']);
  assert.throws(()=>planInventory(shared,f.provisions.slice(0,1),f.registry,'messaging',f.hashes));
  assert.throws(()=>planInventory(shared,f.provisions,{...f.registry,groups:f.registry.groups.slice(0,1),placements:f.registry.placements.slice(0,1)},'messaging',f.hashes));
});
test('full backend expands all thirteen group services and one shared identity, no router',()=>{
  const f=fixture(3),plan=planInventory(shared,f.provisions,f.registry,'full_backend',f.hashes);
  assert.equal(plan.targets.length,40);assert.equal(plan.targets.filter(t=>t.name==='shard_router').length,0);
  for(const g of ['g1','g2','g3'])assert.equal(plan.targets.filter(t=>t.groupId===g).length,13);
});
test('collisions, wrong placement, incomplete domain inventory and registry overflow fail closed',()=>{
  for(const mutate of [f=>{f.provisions[1].canisters.club_domain=f.provisions[0].canisters.club_domain;},f=>{f.registry.placements[0].host='https://wrong.invalid';},f=>{f.registry.groups[0].domains.pop();},f=>{f.registry.placements[0].domains[0].subnet=p('foreign-subnet');},f=>{f.registry.groups=Array(100).fill(f.registry.groups[0]);},f=>{f.registry.configurationRevision=undefined;},f=>{f.registry.placements[0].approved_subnets=[];}]){
    const f=fixture(3);mutate(f);assert.throws(()=>planInventory(shared,f.provisions,f.registry,'app_admin',f.hashes));
  }
});
test('every scope uses the same artifact hash across all group instances',()=>{
  const f=fixture(3);for(const scope of Object.keys(SCOPES)){const plan=planInventory(shared,f.provisions,f.registry,scope,f.hashes);for(const t of plan.targets)assert.equal(t.newHash,hash(2));}
  delete f.hashes.notification_queue;assert.throws(()=>planInventory(shared,f.provisions,f.registry,'app_admin',f.hashes));
});
test('Rust identity and timer omit Motoko persistence while stores preserve memory',()=>{
  const identity=installArgs({name:'identity_access',canisterId:shared.identity_access},'/tmp/identity');assert.equal(identity.includes('--wasm-memory-persistence'),false);assert.match(identity[identity.indexOf('--args')+1],/^\(record \{ governor/);
  assert.equal(installArgs({name:'timer_jobs',canisterId:'timer'},'/tmp/timer').includes('--wasm-memory-persistence'),false);
  const store=installArgs({name:'media_blob_store',canisterId:'store'},'/tmp/store');assert.equal(store[store.indexOf('--wasm-memory-persistence')+1],'keep');assert.equal(store.includes('--args'),false);
  assert.throws(()=>installArgs({name:'shard_router'},'/tmp/router'));
});
function make(){const f=fixture(3),plan=planInventory(shared,f.provisions,f.registry,'app_admin',f.hashes);const binding={...plan,governor:'governor'};return{binding,complete:false,published:false,steps:plan.targets.map(t=>({...t,oldHash:hash(1),settingsHash:hash(3),phase:'ready'})),keys:Object.entries(plan.pii).map(([groupId,canisterId])=>({groupId,receipt:{canisterId,governor:'governor',host:'https://icp-api.io',deploymentId:'mainnet',environment:'ic',keyName:'key_1',moduleHash:hash(4),publicKeyHex:'a'.repeat(192)}}))};}
test('journal pins every group key and target; incomplete or foreign receipts fail',()=>{
  const good=make();validateJournal(good,good.binding);
  for(const mutate of [j=>j.keys.pop(),j=>j.steps.pop(),j=>{j.keys[0].receipt.canisterId='foreign';},j=>{j.steps[0].settingsHash='';},j=>{j.published=true;}]){const j=make();mutate(j);assert.throws(()=>validateJournal(j,j.binding));}
  assert.throws(()=>assertCheckedPlan(hash(1),hash(2)));assertCheckedPlan(digest(good.binding),digest(good.binding));
});
test('different release cannot bypass unsettled or unpublished predecessor',()=>{
  const j=make();assert.throws(()=>requireSettledPredecessor(j));j.complete=true;j.steps.forEach(s=>s.phase='complete');assert.throws(()=>requireSettledPredecessor(j));j.published=true;requireSettledPredecessor(j);
});
test('partial installs resume only exact intended modules without replay',async()=>{
  const j=make(),modules=new Map(j.steps.map(s=>[s.canisterId,s.oldHash])),installed=[];
  const transport={gate:async()=>{},observe:async s=>({moduleHash:modules.get(s.canisterId),settingsHash:s.settingsHash}),verifyKeys:async()=>{},persist:async()=>{},install:async s=>{installed.push(s.canisterId);modules.set(s.canisterId,s.newHash);if(installed.length===1)throw Error('reply lost');}};
  await assert.rejects(executeUpgrades(j,transport));assert.equal(j.steps[0].phase,'pending');
  await executeUpgrades(j,transport);assert.equal(installed.length,4);assert.equal(new Set(installed).size,4);assert.equal(j.complete,true);
});
test('unknown journal acknowledgement stops before install and unknown old module is not replayed',async()=>{
  const j=make();let installs=0;
  const t={gate:async()=>{},observe:async s=>({moduleHash:s.oldHash,settingsHash:s.settingsHash}),verifyKeys:async()=>{},persist:async()=>{throw Error('unknown journal');},install:async()=>{installs++;}};
  await assert.rejects(executeUpgrades(j,t));assert.equal(installs,0);assert.equal(j.steps[0].phase,'pending');t.persist=async()=>{};await assert.rejects(executeUpgrades(j,t));assert.equal(installs,0);
});