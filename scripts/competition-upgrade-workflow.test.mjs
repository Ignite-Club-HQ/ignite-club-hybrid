import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('competition workflow preserves protected manual exact-target deployment',()=>{
  const w=readFileSync(new URL('../.github/workflows/upgrade-competition.yml',import.meta.url),'utf8');
  assert.match(w,/workflow_dispatch:/);assert.match(w,/environment: group-2-admin-controls/);
  assert.match(w,/group: ignite-mainnet-governor-deployment/);assert.match(w,/cancel-in-progress: false/);
  assert.match(w,/icp build notification_queue club_domain events_domain competition_domain\n/);
  assert.doesNotMatch(w,/icp (deploy|cycles)|icp build .*media_blob_store|schedule:/);
  assert.match(w,/upgrade-competition\.ts/);assert.match(w,/produce-routing-gates\.ts/);
});