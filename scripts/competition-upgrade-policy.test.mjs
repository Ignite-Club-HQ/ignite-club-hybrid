import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPETITION_SERVICES, validateRequest, validateTargets, validateRegistration, validateJournal, executeUpgrades } from './competition-upgrade-policy.mjs';
const hash = 'a'.repeat(64);
const targets = ['g1','g2'].flatMap(groupId => COMPETITION_SERVICES.map(name => ({groupId,name,canisterId:`${groupId}-${name}`,subnetId:'subnet',newHash:hash})));
test('only eight competition targets and exact confirmation are allowed', () => {
  validateRequest('upgrade',' UPGRADE BOTH GROUPS COMPETITION '); validateTargets(targets);
  assert.throws(() => validateRequest('upgrade','UPGRADE GROUP 2'));
  assert.throws(() => validateTargets(targets.slice(1)));
  assert.throws(() => validateTargets([...targets,{...targets[0],name:'media_blob_store'}]));
  assert.throws(() => validateTargets(targets.map((t,i) => i===7 ? {...t,canisterId:targets[0].canisterId} : t)));
});
test('every registered domain and subnet must match', () => {
  const p = x => ({toText:()=>x}); const own = targets.filter(t => t.groupId==='g2');
  const domains = own.map(t => ({domain:t.name,canister:p(t.canisterId),subnet:p(t.subnetId)}));
  const g={id:'g2',target_alias:'mainnet',domains}; const row={group_id:'g2',deployment_id:'mainnet',host:'https://icp-api.io',network_kind:'public_mainnet',domains};
  validateRegistration('g2',targets,[g],[row]);
  assert.throws(() => validateRegistration('g2',targets,[g],[{...row,domains:domains.slice(1)}]));
  assert.throws(() => validateRegistration('g2',targets,[g],[{...row,host:'https://other.invalid'}]));
});
test('eight-step journal binds both keys and original wiring', () => {
  const binding={targets,governor:'gov',pii:{g1:'p1',g2:'p2'},wiring:Object.fromEntries(targets.map(t=>[t.canisterId,hash]))};
  const j={binding,complete:false,steps:targets.map(t=>({...t,oldHash:hash,settingsHash:hash,phase:'ready'})),keys:['g1','g2'].map(groupId=>({groupId,receipt:{governor:'gov',canisterId:binding.pii[groupId],host:'https://icp-api.io',deploymentId:'mainnet',environment:'ic',keyName:'key_1',publicKeyHex:'a'.repeat(192),moduleHash:hash}}))};
  validateJournal(j,binding);
  assert.throws(()=>validateJournal({...j,keys:j.keys.slice(1)},binding));
  assert.throws(()=>validateJournal(j,{...binding,wiring:{}}));
});
test('unknown upgrade never repeats install',async()=>{
  const j={steps:[{...targets[0],phase:'pending',oldHash:'b'.repeat(64),settingsHash:hash}],complete:false}; let installs=0;
  await assert.rejects(executeUpgrades(j,{gate:async()=>{},observe:async()=>({moduleHash:'b'.repeat(64),settingsHash:hash}),persist:async()=>{},install:async()=>{installs++;},verifyKeys:async()=>{}}),/Unknown upgrade outcome/);
  assert.equal(installs,0);assert.equal(j.complete,false);
});