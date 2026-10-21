import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, verifyIdentityStatus, reconcileIdentityUpgrade, GOVERNOR } from './group2-admission-release-rules.mjs';
test('only explicit account access repair and disable confirmations authorize writes', () => {
  assert.doesNotThrow(()=>validateRequest('repair',' REPAIR GROUP 2 ACCOUNT ACCESS '));
  assert.throws(()=>validateRequest('repair','OPEN GROUP 2 TO EVERYONE'));
  assert.throws(()=>validateRequest('repair',''));
  assert.throws(()=>validateRequest('disable','REPAIR GROUP 2 ACCOUNT ACCESS'));
  assert.doesNotThrow(()=>validateRequest('disable','DISABLE GROUP 2 ACCOUNT ACCESS'));
});
test('identity release requires sole governor, fuel and no rehearsal flag',()=> {
  const s={controllers:[GOVERNOR],running:true,moduleHash:'ab'.repeat(32),cycles:1_000_000_000_000n,environment:[]};
  assert.doesNotThrow(()=>verifyIdentityStatus(s));
  assert.throws(()=>verifyIdentityStatus({...s,controllers:[GOVERNOR,'other']}));
  assert.throws(()=>verifyIdentityStatus({...s,cycles:999_999_999_999n}));
  assert.throws(()=>verifyIdentityStatus({...s,environment:[{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]}));
});
test('ambiguous upgrade never replays; exact new module settles pending',()=> {
  const step={oldHash:'ab'.repeat(32),newHash:'cd'.repeat(32),settingsHash:'env',subnetId:'subnet',phase:'pending'};
  const actual={moduleHash:step.oldHash,settingsHash:'env',subnetId:'subnet'};
  assert.throws(()=>reconcileIdentityUpgrade(step,actual),/no automatic replay/);
  assert.equal(reconcileIdentityUpgrade(step,{...actual,moduleHash:step.newHash}).phase,'complete');
  assert.throws(()=>reconcileIdentityUpgrade(step,{...actual,moduleHash:step.newHash,settingsHash:'changed'}));
});