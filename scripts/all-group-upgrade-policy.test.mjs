import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planInventory, SCOPES, PRIMARY_SUBNET, validateRequest, installArgs, digest, assertCheckedPlan, validateJournal, requireSettledPredecessor, requireSettledNarrowRelease, executeUpgrades, requireCompletedRecovery, galleryAuthorities, verifyCompletedRecovery } from './all-group-upgrade-policy.mjs';
import { GROUP_BUILD_SERVICES } from './stage-group-wasm.mjs';
const shared=JSON.parse(readFileSync(new URL('../deploy/mainnet/.icp/data/mappings/ic.ids.json',import.meta.url)));
const original=JSON.parse(readFileSync(new URL('../deploy/groups/g2/provision.json',import.meta.url)));
const hash=n=>String(n).repeat(64);
const p=id=>({toText:()=>id});
function completedLookup(){
  const targets=[{name:'identity_access',canisterId:shared.identity_access,newHash:hash(2)},{name:'club_domain',canisterId:shared.club_domain,newHash:hash(2)},{name:'club_domain',canisterId:original.canisters.club_domain,newHash:hash(2)}];
  return {binding:{release:'b'.repeat(40),sources:[{groupId:'g1'},{groupId:'g2'}],targets},complete:true,ready:false,published:false,steps:targets.map(t=>({...t,phase:'complete'})),fill:{g1:true,g2:true},ownership:{complete:true},replicaAcceptance:{snapshotVerified:true,restorationGuardVerified:true},activation:{release:'b'.repeat(40),phase:'complete'}};
}
test('settled three-target lookup with ready:false and legacy published:false does not block successor or change readiness',()=>{
  const j=completedLookup(),before=JSON.stringify(j);
  requireSettledNarrowRelease('membership-lookup-release-receipts',j);
  assert.equal(JSON.stringify(j),before);assert.equal(j.ready,false);assert.equal(j.published,false);
});
test('lookup pending installation still blocks the complete upgrade',()=>{
  const j=completedLookup();j.steps[1].phase='pending';assert.throws(()=>requireSettledNarrowRelease('membership-lookup-release-receipts',j));
});
test('lookup missing source fill or unsettled activation cannot bypass the gate',()=>{
  for(const mutate of [j=>{j.fill.g2=false;},j=>{delete j.fill.g2;},j=>{j.activation.phase='pending';},j=>{j.activation.release='c'.repeat(40);},j=>{j.replicaAcceptance.snapshotVerified=false;},j=>{j.ownership.complete=false;},j=>{j.steps.pop();}]){const j=completedLookup();mutate(j);assert.throws(()=>requireSettledNarrowRelease('membership-lookup-release-receipts',j));}
});
test('other narrow releases retain readiness and backfill refusal',()=>{
  const j=completedLookup();assert.throws(()=>requireSettledNarrowRelease('media-paging-upgrade-receipts',j));j.ready=true;j.backfill={g1:false};assert.throws(()=>requireSettledNarrowRelease('media-paging-upgrade-receipts',j));
});
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
test('migration readiness upgrades only the club service in every registered group, including closed groups',()=>{
  const f=fixture(4);
  f.registry.groups.forEach(g=>{g.enabled=false;g.admission_enabled=false;});
  const plan=planInventory(shared,f.provisions,f.registry,'club_migration',f.hashes);
  assert.deepEqual(SCOPES.club_migration,['club_domain']);
  assert.deepEqual(plan.targets.map(t=>[t.groupId,t.name]),[['g1','club_domain'],['g2','club_domain'],['g3','club_domain'],['g4','club_domain']]);
  assert.equal(plan.targets[0].canisterId,shared.club_domain);
  assert.equal(plan.targets[1].canisterId,original.canisters.club_domain);
});
test('cleanup targets identity once and only PII/club across every group',()=>{
  assert.deepEqual(SCOPES.private_name_cleanup,['identity_access','pii_access_control','club_domain']);
  const f=fixture(4),p=planInventory(shared,f.provisions,f.registry,'private_name_cleanup',f.hashes);
  assert.equal(p.targets.length,9);
  assert.equal(p.targets.filter(t=>t.name==='identity_access').length,1);
  for(const g of p.groups)assert.deepEqual(p.targets.filter(t=>t.groupId===g.id).map(t=>t.name),['pii_access_control','club_domain']);
  assert.equal(p.targets.some(t=>t.name==='shard_router'||t.name==='media_blob_store'),false);
  assert.throws(()=>planInventory(shared,f.provisions.slice(0,1),f.registry,'private_name_cleanup',f.hashes),/inventory differ/);
});
test('secure saving and club display are separate all-group scopes, with no unrelated services',()=>{
  const f=fixture(4);
  assert.deepEqual(SCOPES.secure_name_save,['pii_access_control','identity_access']);
  assert.deepEqual(SCOPES.private_club_name_display,['pii_access_control','club_domain','identity_access']);
  for(const scope of ['secure_name_save','private_club_name_display']) {
    const plan=planInventory(shared,f.provisions,f.registry,scope,f.hashes);
    assert.equal(plan.targets.filter(t=>t.name==='identity_access').length,1);
    assert.equal(plan.targets.filter(t=>t.name==='pii_access_control').length,4);
    assert.equal(plan.targets.filter(t=>t.name==='club_domain').length,scope==='secure_name_save'?0:4);
    assert.equal(plan.targets.some(t=>!SCOPES[scope].includes(t.name)),false);
    assert.throws(()=>planInventory(shared,f.provisions.slice(0,1),f.registry,scope,f.hashes));
  }
});
test('migration readiness refuses to omit a registered destination group',()=>{
  const f=fixture(4);
  assert.throws(()=>planInventory(shared,f.provisions.slice(0,1),f.registry,'club_migration',f.hashes),/inventory differ/);
});
test('complete release includes all 18 original and every future group service exactly once',()=>{
  const f=fixture(4),full=planInventory(shared,f.provisions,f.registry,'full_backend',f.hashes);
  assert.equal(full.targets.length,57);
  assert.deepEqual(new Set(full.targets.filter(t=>t.groupId==='g1'||t.groupId==='shared').map(t=>t.canisterId)),new Set(Object.values(shared)));
  for(const name of ['shard_router','identity_access','placement_registry','migration_coordinator','secret_workload_identity'])assert.equal(full.targets.filter(t=>t.name===name).length,1);
  for(const groupId of ['g1','g2','g3','g4'])assert.deepEqual(full.targets.filter(t=>t.groupId===groupId).map(t=>t.name),[...GROUP_BUILD_SERVICES]);
  assert.throws(()=>planInventory({...shared,unknown_service:'unknown-service-cai'},f.provisions,f.registry,'full_backend',f.hashes));
});
test('gallery/vault remains a narrow all-group release',()=>{
  const f=fixture(3);
  const plan=planInventory(shared,f.provisions,f.registry,'gallery_vault',f.hashes);
  assert.equal(plan.targets.length,18);assert.equal(plan.targets.filter(t=>t.name==='shard_router').length,0);
  for(const g of ['g1','g2','g3'])assert.equal(plan.targets.filter(t=>t.groupId===g).length,6);
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
test('unexpected or duplicated saved domain names fail before target creation',()=>{
  for(const mutate of [p=>{p.canisters.extra=p.canisters.club_domain;delete p.canisters.club_domain;},p=>{p.installedDomains[0]=p.installedDomains[1];}]){const f=fixture();mutate(f.provisions[0]);assert.throws(()=>planInventory(shared,f.provisions,f.registry,'app_admin',f.hashes));}
});
test('Rust identity and timer omit Motoko persistence while stores preserve memory',()=>{
  const identity=installArgs({name:'identity_access',canisterId:shared.identity_access},'/tmp/identity');assert.equal(identity.includes('--wasm-memory-persistence'),false);assert.match(identity[identity.indexOf('--args')+1],/^\(record \{ governor/);
  assert.equal(installArgs({name:'timer_jobs',canisterId:'timer'},'/tmp/timer').includes('--wasm-memory-persistence'),false);
  const store=installArgs({name:'media_blob_store',canisterId:'store'},'/tmp/store');assert.equal(store[store.indexOf('--wasm-memory-persistence')+1],'keep');assert.equal(store.includes('--args'),false);
  for(const name of ['shard_router','placement_registry']){const args=installArgs({name,canisterId:shared[name]},'/tmp/shared');assert.equal(args.includes('--wasm-memory-persistence'),false);assert.match(args[args.indexOf('--args')+1],/^\(record \{ governor/);}
  for(const name of ['migration_coordinator','secret_workload_identity','pii_access_control'])assert.equal(installArgs({name,canisterId:shared[name]},'/tmp/shared').includes('--wasm-memory-persistence'),true);
  assert.throws(()=>installArgs({name:'unknown'},'/tmp/unknown'));
});
test('complete release upgrades unchanged modules once and never repeats completed steps',async()=>{
  const j=make();j.steps.forEach(s=>s.oldHash=s.newHash);const installed=[];
  const transport={upgradeUnchanged:true,gate:async()=>{},observe:async s=>({moduleHash:s.newHash,settingsHash:s.settingsHash}),persist:async()=>{},verifyKeys:async()=>{},install:async s=>installed.push(s.canisterId)};
  await executeUpgrades(j,transport);assert.equal(installed.length,4);
  await executeUpgrades(j,transport);assert.equal(installed.length,4);
});
test('unchanged-module lost replies stay locked instead of claiming success from equal hashes',async()=>{
  const j=make();j.steps.forEach(s=>s.oldHash=s.newHash);let installs=0;
  const transport={upgradeUnchanged:true,gate:async()=>{},observe:async s=>({moduleHash:s.newHash,settingsHash:s.settingsHash}),persist:async()=>{},verifyKeys:async()=>{},install:async()=>{installs++;throw Error('lost reply');}};
  await assert.rejects(executeUpgrades(j,transport));assert.equal(j.steps[0].phase,'pending');
  await assert.rejects(executeUpgrades(j,transport),/hash equality cannot prove/);assert.equal(installs,1);
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
test('module completion alone cannot claim release completion before snapshot/backfill',()=>{
  const j=make();j.complete=true;j.steps.forEach(s=>s.phase='complete');assert.throws(()=>validateJournal(j,j.binding));
  j.snapshotVerified=true;j.snapshotFiles=[{path:'frontend/src/live/generated/routingGates.ts',content:'verified'}];j.snapshotFilesHash=digest(j.snapshotFiles);validateJournal(j,j.binding);
  j.snapshotFiles[0].content='tampered';assert.throws(()=>validateJournal(j,j.binding));
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
function recoverable(){
  const j=make();j.binding.repo='Ignite-Club-HQ/ignite-club-hybrid';j.binding.scope='app_admin';j.binding.release='a'.repeat(40);
  j.modulesComplete=true;j.steps.forEach(s=>s.phase='complete');return j;
}
const recoveryOptions=j=>({repo:j.binding.repo,scope:j.binding.scope,checkedPlan:digest(j.binding),source:'b'.repeat(40),branch:'refs/heads/main'});
test('recovery preserves original release and saved artifacts without rebinding',()=>{
  const j=recoverable(),before=JSON.stringify(j),r=requireCompletedRecovery(j,recoveryOptions(j));
  assert.equal(r.release,'a'.repeat(40));assert.equal(r.hashes.notification_queue,hash(2));assert.equal(JSON.stringify(j),before);
  validateRequest('recover','app_admin','RECOVER COMPLETED MAINNET RELEASE',digest(j.binding));
  assert.throws(()=>validateRequest('recover','app_admin','UPGRADE ALL MAINNET GROUPS',digest(j.binding)));
});
test('recovery rejects unknown or unacknowledged installs, foreign plans and changed recovery source',()=>{
  for(const mutate of [j=>{j.modulesComplete=false;},j=>{j.steps[0].phase='pending';j.steps[0].oldHash=j.steps[0].newHash;},j=>{j.steps[0].phase='ready';},j=>{j.keys.pop();},j=>{j.binding.release='invalid';},j=>{j.recovery={source:'c'.repeat(40),branch:'refs/heads/main'};}]){
    const j=recoverable(),options=recoveryOptions(j);mutate(j);assert.throws(()=>requireCompletedRecovery(j,options));
  }
  const j=recoverable();assert.throws(()=>requireCompletedRecovery(j,{...recoveryOptions(j),checkedPlan:hash(9)}));
  assert.throws(()=>requireCompletedRecovery(null,recoveryOptions(j)));
});
test('recovery verifies every saved module/settings twice and never installs',async()=>{
  const j=recoverable();let reads=0,keys=0,gates=0,installs=0;
  await verifyCompletedRecovery(j,{gate:async()=>{gates++;},observe:async s=>{reads++;return{moduleHash:s.newHash,settingsHash:s.settingsHash};},verifyKeys:async()=>{keys++;},install:async()=>{installs++;}});
  assert.equal(reads,j.steps.length*2);assert.equal(keys,2);assert.equal(gates,4);assert.equal(installs,0);
});
test('recovery stops on module/settings/wiring/key drift without mutating receipts',async()=>{
  for(const drift of ['module','settings','wiring','key']){
    const j=recoverable(),before=JSON.stringify(j);
    await assert.rejects(verifyCompletedRecovery(j,{gate:async()=>{if(drift==='wiring')throw Error('wiring changed');},observe:async s=>({moduleHash:drift==='module'?hash(8):s.newHash,settingsHash:drift==='settings'?hash(8):s.settingsHash}),verifyKeys:async()=>{if(drift==='key')throw Error('key changed');}}));
    assert.equal(JSON.stringify(j),before);
  }
});
test('gallery authorities use planned G1 inventory without a provision file and exact future-group pairs',()=>{
  const f=fixture(3),inventory=planInventory(shared,f.provisions,f.registry,'gallery_vault',f.hashes);
  for(const groupId of ['g1','g2','g3']){
    const t=inventory.targets.find(t=>t.groupId===groupId&&t.name==='media_metadata');
    const pair=galleryAuthorities(inventory,t,f.provisions),group=inventory.groups.find(g=>g.id===groupId);
    assert.equal(pair.club,group.services.find(s=>s.name==='club_domain').canisterId);assert.equal(pair.vault,group.services.find(s=>s.name==='vault_domain').canisterId);
  }
  const t=inventory.targets.find(t=>t.groupId==='g1'&&t.name==='media_metadata');
  assert.deepEqual(galleryAuthorities(inventory,t,[]),{club:shared.club_domain,vault:shared.vault_domain});
  assert.throws(()=>galleryAuthorities(inventory,{...t,canisterId:'foreign-cai'},[]));
  assert.throws(()=>galleryAuthorities(inventory,t,[{groupId:'g1',canisters:{club_domain:'foreign-cai',vault_domain:shared.vault_domain}}]));
});
test('recover accepts pasted hash/wording with stray spaces, quotes or line breaks', async () => {
  const { validateRequest } = await import('./all-group-upgrade-policy.mjs');
  const plan = 'eac3e577bb4e5998cad15271ef868e50a623a6e4c5b2eb7b54843ad709940b5c';
  assert.ok(validateRequest('recover', 'full_backend', ' “RECOVER  COMPLETED MAINNET RELEASE”\n', `\`${plan.toUpperCase()}\` \n`).length);
  assert.throws(() => validateRequest('recover', 'full_backend', 'UPGRADE ALL MAINNET GROUPS', plan), /Confirmation box must say RECOVER/);
  assert.throws(() => validateRequest('recover', 'full_backend', 'RECOVER COMPLETED MAINNET RELEASE', plan.slice(1)), /received 63 characters/);
});
