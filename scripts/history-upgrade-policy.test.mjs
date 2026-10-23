import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, validateTargets, validateRegistration, executeUpgrades } from './history-upgrade-policy.mjs';
const targets = ['competition_domain', 'events_domain'].map(name => ({groupId:'g2',name,canisterId:name,subnetId:'subnet',newHash:'2'.repeat(64)}));
test('only two Group 2 competition/events services can upgrade', () => {
  validateTargets(targets);
  for (const bad of [targets.slice(1), [...targets, {...targets[0],name:'media_blob_store'}], targets.map(t=>({...t,groupId:'g1'})), targets.map(t=>({...t,canisterId:'same'}))]) assert.throws(()=>validateTargets(bad));
});
test('upgrade requires the exact scoped confirmation', () => {
  validateRequest('upgrade',' UPGRADE GROUP 2 COMPETITION EVENTS\n');
  assert.throws(()=>validateRequest('upgrade','UPGRADE GROUP 2'));
});
test('both registry and placement must match the exact destinations', () => {
  const p = text => ({toText:()=>text});
  const domains=targets.map(t=>({domain:t.name,canister:p(t.canisterId),subnet:p(t.subnetId)}));
  const groups=[{id:'g2',target_alias:'mainnet',domains}];
  const placements=[{group_id:'g2',deployment_id:'mainnet',host:'https://icp-api.io',network_kind:'public_mainnet',domains}];
  validateRegistration(targets,groups,placements);
  assert.throws(()=>validateRegistration(targets,groups,[{...placements[0],domains:domains.slice(1)}]));
});
test('shared loop upgrades exactly two targets and never replays unknown installs', async () => {
  const journal={complete:false,steps:targets.map(t=>({...t,oldHash:'1'.repeat(64),settingsHash:'3'.repeat(64),phase:'ready'}))};
  const hashes=new Map(journal.steps.map(s=>[s.canisterId,s.oldHash])); let installs=0;
  const transport={gate:async()=>{},persist:async()=>{},verifyKeys:async()=>{},observe:async s=>({moduleHash:hashes.get(s.canisterId),settingsHash:s.settingsHash}),install:async s=>{installs++;hashes.set(s.canisterId,s.newHash);}};
  await executeUpgrades(journal,transport); assert.equal(installs,2); assert.equal(journal.complete,true);
  await executeUpgrades(journal,transport); assert.equal(installs,2);
  journal.complete=false; journal.steps[0].phase='pending';hashes.set(journal.steps[0].canisterId,journal.steps[0].oldHash);
  await assert.rejects(executeUpgrades(journal,transport),/Unknown upgrade outcome/);assert.equal(installs,2);
});