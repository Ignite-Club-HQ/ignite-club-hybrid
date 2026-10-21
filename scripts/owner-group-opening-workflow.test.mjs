import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const workflow = readFileSync(new URL('../.github/workflows/owner-group-opening.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../frontend/scripts/owner-group-opening.ts', import.meta.url), 'utf8');
test('owner operations require a protected environment and existing deploy key', () => {
  assert.match(workflow, /environment: group-2-owner-opening/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /secrets\.DEPLOYER_PEM/);
  assert.doesNotMatch(workflow, /identity new|icp deploy|LOCAL_REHEARSAL.*1/);
});
test('opening is explicitly confirmed and checked before a signed grant', () => {
  assert.match(runner, /CONFIRMATION\?\.trim\(\) !== 'OPEN GROUP 2 OWNER TEST'/);
  assert.match(runner, /CONFIRMATION\?\.trim\(\) !== 'STOP GROUP 2 TEST PLACEMENTS'/);
  assert.ok(runner.indexOf('verifyOwnerReciprocalConfiguration(spec') < runner.indexOf('router.open_owner_test_group(approval)'));
  assert.ok(runner.indexOf('save(intent)') < runner.indexOf('router.open_owner_test_group(approval)'));
  assert.match(runner, /readback\.approval\.evidence_sha256 !== evidence_sha256/);
});
test('reports whitelist public configuration and durably save mutation intent', () => {
  assert.match(runner, /environment_variables\.filter/);
  assert.match(runner, /fsyncSync\(fd\)/);
  assert.match(runner, /renameSync\(temp, out\)/);
  assert.doesNotMatch(runner, /console\.log\(.*environment/);
});