import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, validateTargets, validateRegisteredPair, validateJournal, executeUpgrades } from './subscription-upgrade-policy.mjs';
const hash = n => String(n).repeat(64);
const targets = ['g1','g2'].flatMap(groupId => ['club_domain','media_blob_store'].map(name => ({ groupId, name, canisterId: `${groupId}-${name}`, subnetId: 'subnet', newHash: hash(2) })));
const binding = { governor: 'governor', pii: { g1: 'pii1', g2: 'pii2' }, targets };
const make = () => ({ binding, complete: false, steps: targets.map(t => ({ ...t, oldHash: hash(1), settingsHash: hash(3), phase: 'ready' })),
  keys: ['g1','g2'].map(groupId => ({ groupId, receipt: { governor: 'governor', canisterId: binding.pii[groupId], host: 'https://icp-api.io', deploymentId: 'mainnet', environment: 'ic', keyName: 'key_1', publicKeyHex: 'a'.repeat(192), moduleHash: hash(4) } })) });
test('upgrade requires explicit confirmation, surrounding mobile whitespace allowed', () => {
  validateRequest('check', ''); validateRequest('upgrade', ' UPGRADE BOTH GROUPS SUBSCRIPTIONS\n');
  assert.throws(() => validateRequest('upgrade', 'UPGRADE GROUP 2'));
  assert.throws(() => validateRequest('reload', 'UPGRADE BOTH GROUPS SUBSCRIPTIONS'));
});
test('only both clubs and their distinct stores are eligible', () => {
  validateTargets(targets);
  assert.throws(() => validateTargets(targets.slice(1)));
  assert.throws(() => validateTargets(targets.map((t,i) => i === 3 ? {...t,canisterId:targets[0].canisterId}:t)));
  assert.throws(() => validateTargets(targets.map((t,i) => i === 3 ? {...t,name:'identity_access'}:t)));
});
test('journal binds all four modules/settings and both original photo keys', () => {
  validateJournal(make(), binding);
  for (const mutate of [j => {j.steps.pop();}, j => {j.steps[0].settingsHash='';}, j=>{j.keys[1].receipt.canisterId='foreign';}, j=>{j.steps[1].canisterId=j.steps[0].canisterId;}, j=>{j.complete=true;}]) {
    const j=make(); mutate(j); assert.throws(()=>validateJournal(j,binding));
  }
  assert.throws(()=>validateJournal(make(), {...binding,governor:'other'}));
});
test('registered Group 1 and Group 2 must match the paired authority and placement', () => {
  const p = value => ({toText:()=>value});
  for (const groupId of ['g1','g2']) {
    const club=targets.find(t=>t.groupId===groupId&&t.name==='club_domain');
    const store=targets.find(t=>t.groupId===groupId&&t.name==='media_blob_store');
    const group={id:groupId,target_alias:'mainnet',domains:[{domain:'club_domain',canister:p(club.canisterId)}],photo_store:[p(store.canisterId)]};
    const placement={group_id:groupId,deployment_id:'mainnet',host:'https://icp-api.io',network_kind:'public_mainnet',domains:[{domain:'club_domain',canister:p(club.canisterId),subnet:p('subnet')}]};
    validateRegisteredPair(groupId,targets,[group],[placement]);
    assert.throws(()=>validateRegisteredPair(groupId,targets,[{...group,photo_store:[p('foreign')]}],[placement]));
    assert.throws(()=>validateRegisteredPair(groupId,targets,[group],[{...placement,host:'https://other.invalid'}]));
    assert.throws(()=>validateRegisteredPair(groupId,targets,[group],[{...placement,domains:[]} ]));
  }
  validateRegisteredPair('g1',targets,[],[]);
  assert.throws(()=>validateRegisteredPair('g2',targets,[],[]));
});
function transport(journal, options={}) {
  const modules=new Map(journal.steps.map(s=>[s.canisterId,s.oldHash]));
  const events=[];
  return {modules,events, gate:async()=>{events.push('gate'); if(options.gateFails)throw Error('drift');},
    observe:async s=>({moduleHash:modules.get(s.canisterId),settingsHash:options.settingsDrift?hash(9):s.settingsHash}),
    persist:async j=>{events.push(`persist:${j.steps.map(s=>s.phase).join(',')}`); if(options.persistFails)throw Error('lost journal reply');},
    install:async s=>{events.push(`install:${s.canisterId}`); modules.set(s.canisterId,s.newHash); if(options.installReplyLost)throw Error('lost install reply');},
    verifyKeys:async()=>{events.push('keys');if(options.keyFails)throw Error('key mismatch');} };
}
test('real shared runner journals intent before each of exactly four installs', async()=>{
  const j=make(), t=transport(j); await executeUpgrades(j,t);
  assert.equal(j.complete,true); assert.equal(t.events.filter(e=>e.startsWith('install:')).length,4);
  for(const [i,e] of t.events.entries())if(e.startsWith('install:'))assert.match(t.events[i-1],/^persist:.*pending/);
});
test('lost install reply retains pending; exact readback settles without replay', async()=>{
  const j=make(), t=transport(j,{installReplyLost:true});
  await assert.rejects(executeUpgrades(j,t)); assert.equal(j.steps[0].phase,'pending'); assert.equal(j.complete,false);
  const resumed=transport(j); resumed.modules.set(j.steps[0].canisterId,hash(2)); await executeUpgrades(j,resumed);
  assert.equal(resumed.events.filter(e=>e.startsWith('install:')).length,3); assert.equal(j.complete,true);
});
test('unknown pending outcome on old code never repeats install',async()=>{
  const j=make();j.steps[0].phase='pending';const t=transport(j);
  await assert.rejects(executeUpgrades(j,t),/Unknown upgrade outcome/);assert.equal(t.events.some(e=>e.startsWith('install:')),false);
});
test('journal write failure, routing drift or settings drift stop before installing',async()=>{
  for(const options of [{persistFails:true},{gateFails:true},{settingsDrift:true}]){
    const j=make(),t=transport(j,options);await assert.rejects(executeUpgrades(j,t));assert.equal(t.events.some(e=>e.startsWith('install:')),false);assert.equal(j.complete,false);
  }
});
test('photo-key failure prevents marking release complete',async()=>{
  const j=make(),t=transport(j,{keyFails:true});await assert.rejects(executeUpgrades(j,t),/key mismatch/);assert.equal(j.complete,false);
});
test('completed release re-verifies and never reinstalls',async()=>{
  const j=make(),t=transport(j);await executeUpgrades(j,t);t.events.length=0;await executeUpgrades(j,t);
  assert.equal(t.events.some(e=>e.startsWith('install:')),false);assert.ok(t.events.includes('keys'));
});