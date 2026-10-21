import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const workflow = readFileSync(new URL('../.github/workflows/stop-group2-placements.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../frontend/scripts/stop-group-placements.ts', import.meta.url), 'utf8');
test('administrator stop is manual, protected and has no opening action', () => {
  assert.match(workflow, /options: \[check, stop\]/);
  assert.match(workflow, /environment: group-2-admin-controls/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /secrets\.DEPLOYER_PEM/);
  assert.doesNotMatch(runner, /\.open_owner_test_group\(|\.register_group\(|identity new|fetchRootKey/);
});
test('stop requires exact confirmation and revision before a single signed mutation', () => {
  assert.match(runner, /STOP GROUP 2 NEW CLUBS/);
  assert.ok(runner.indexOf("pending: 'stop'") < runner.indexOf('await router.stop_group_new_placements'));
  assert.ok(runner.indexOf('BigInt(revisionText) !== registry.revision') < runner.indexOf('await router.stop_group_new_placements'));
  assert.match(runner, /stopped\.assigned_clubs !== group\.assigned_clubs/);
  assert.match(runner, /fsyncSync\(fd\)/);
  assert.doesNotMatch(runner, /spec\.owner|approval_file|clubIds/);
});