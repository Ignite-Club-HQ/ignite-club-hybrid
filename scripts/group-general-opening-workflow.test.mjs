import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync(new URL('../.github/workflows/open-group-general.yml', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../frontend/scripts/set-group-service-settings.ts', import.meta.url), 'utf8');
const snapshot = readFileSync(new URL('../frontend/scripts/produce-routing-gates.ts', import.meta.url), 'utf8');
const opening = readFileSync(new URL('../frontend/scripts/open-group-general.ts', import.meta.url), 'utf8');

test('manual opening workflow is protected and serialized with existing mainnet deployment', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: group-2-admin-controls/);
  assert.match(workflow, /group: ignite-mainnet-governor-deployment/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /secrets\.DEPLOYER_PEM/);
  assert.doesNotMatch(workflow, /identity new|cycles mint|icp deploy|icp canister install/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /rm -f "\$RUNNER_TEMP\/operator\.pm|rm -f "\$RUNNER_TEMP\/operator\.pem"/);
});

test('approvals must be committed under deploy/groups/g2', () => {
  assert.match(workflow, /deploy\/groups\/g2\/\*\.json/);
});

test('settings runner requires exact confirmation before any mutation', () => {
  assert.ok(settings.indexOf("CONFIRMATION?.trim() !== 'SET SERVICE SETTINGS'") < settings.indexOf('update_settings'));
  assert.match(settings, /readPinnedGroupRegistry/);
});

test('settings bind identity first, verify, then switch the admission flag', () => {
  assert.ok(settings.indexOf("phase: 'identity-binding'") < settings.indexOf("phase: 'admission-flag'"));
  assert.ok(settings.indexOf("phase: 'admission-flag'") < settings.indexOf("phase: 'creator-binding'"));
  assert.match(settings, /new Map\(\(await envOf/);
  assert.match(settings, /readback failed/);
});

test('settings preserve existing environment variables when writing', () => {
  assert.match(settings, /environment_variables is a replace-all setting/);
});

test('snapshot is governor-verified, wired to removal proof, and writes the committed frontend file', () => {
  assert.match(snapshot, /Existing deployment administrator required/);
  assert.match(snapshot, /verifyRemovalWiring/);
  assert.match(snapshot, /verifyOwnerReciprocalConfiguration/);
  assert.match(snapshot, /src\/live\/generated\/routingGates\.ts/);
  assert.match(snapshot, /evidenceSha256/);
  assert.match(snapshot, /older registry revision/);
});

test('opening runner gates every mutation behind its exact phrase and a revision CAS', () => {
  assert.match(opening, /'OPEN GROUP 2 TO EVERYONE'/);
  assert.match(opening, /'CLOSE GROUP 2 TO NEW CLUBS'/);
  assert.match(opening, /'REGISTER GROUP 2 CLOSED'/);
  for (const phrase of Object.values({ a: 'OPEN GROUP 2 TO EVERYONE', b: 'CLOSE GROUP 2 TO NEW CLUBS', c: 'REGISTER GROUP 2 CLOSED' })) {
    const call = opening.indexOf('router.register_group');
    const check = opening.indexOf(phrase);
    assert.ok(check > -1);
    assert.ok(call > check || actionOrderSafe(opening, phrase), phrase);
  }
  assert.match(opening, /open readback failed|Close readback failed|reconcile manually/);
});

function actionOrderSafe(source: string, phrase: string) {
  // register-closed branch performs its own confirmation check up top; the
  // check/open/close branch confirms before register_group as well.
  return source.indexOf(phrase) < source.indexOf('router.register_group');
}

test('opening refuses an already-open group on register-closed and requires recorded fingerprints', () => {
  assert.match(opening, /already open; run close first/);
  assert.match(opening, /no recorded module fingerprints/);
  assert.match(opening, /already open'/);
});

test('open requires removal wiring for every registered group before flipping admission', () => {
  assert.match(opening, /Removal wiring incomplete; fix before opening/);
  assert.match(opening, /verifyOwnerOpeningChecks\(spec, observed, group, placement\)/);
  assert.match(opening, /record_group_health\('g2', largestHeap, lowestCycles/);
});
