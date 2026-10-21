import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('repair workflow remains protected identity-only and refreshes snapshot after verification',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/repair-group2-account-access.yml',import.meta.url),'utf8');
  const runner=readFileSync(new URL('../frontend/scripts/repair-group2-admission.ts',import.meta.url),'utf8');
  assert.match(workflow,/environment: group-2-admin-controls/);
  assert.match(workflow,/group: ignite-mainnet-governor-deployment/);
  assert.match(workflow,/icp build identity_access/);
  assert.doesNotMatch(workflow,/icp deploy|--mode auto|--mode reinstall|icp cycles/);
  assert.ok(workflow.indexOf('scripts/produce-routing-gates.ts')>workflow.indexOf('scripts/repair-group2-admission.ts'));
  assert.match(runner,/persistGroup2Journal/);
  assert.match(runner,/'--mode','upgrade'/);
  assert.doesNotMatch(runner,/update_settings|set_service_authorities|set_club_authorities|register_group\(/);
});