import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync(new URL('../.github/workflows/report-group-health.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../frontend/scripts/report-group-health.ts', import.meta.url), 'utf8');

test('scheduled reporting is frequent enough for the two-hour health window', () => {
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron: '\*\/10 \* \* \* \*'/);
});

test('reporting is governor-signed, serialized and never leaves the key behind', () => {
  assert.match(workflow, /secrets\.DEPLOYER_PEM/);
  assert.match(workflow, /group: ignite-group-health-report/);
  assert.ok(workflow.indexOf('rm -f "$RUNNER_TEMP/operator.pem"') > workflow.indexOf('report-group-health.ts'));
  assert.match(workflow, /if: always\(\)/);
});

test('the reporter uses the router contract, not management canister calls', () => {
  assert.match(runner, /read_group_registry_page/);
  assert.match(runner, /record_group_health\(group\.id, largestHeap, lowestCycles, revision\)/);
  assert.doesNotMatch(runner, /update_settings|canister_status/);
});

test('the reporter is anonymous-read only and refuses partial or live-shared readings', () => {
  assert.match(runner, /AnonymousIdentity/);
  assert.match(runner, /never report partial readings/);
  assert.match(runner, /lists a live legacy canister/);
});

test('shared infrastructure is registered but never counted as group capacity', () => {
  assert.match(runner, /filter\(d => d\.domain !== 'secret_workload_identity'\)/);
  assert.match(runner, /not the group's own capacity/);
});

test('the report is a durable receipt whose revision binding can be audited', () => {
  assert.match(runner, /evidenceSha256|evidence = createHash\('sha256'\)/);
  assert.match(runner, /No group health reported/);
  assert.match(runner, /health report rejected/);
});
