import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const workflow = readFileSync(new URL('../.github/workflows/upgrade-group2.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../frontend/scripts/upgrade-group2.mjs', import.meta.url), 'utf8');
test('isolated tool home is initialized at step scope where runner paths are available', () => {
  const jobHeader = workflow.slice(workflow.indexOf('  upgrade:'), workflow.indexOf('    steps:'));
  assert.doesNotMatch(jobHeader, /runner\./);
  assert.match(workflow, /ICP_HOME=\$RUNNER_TEMP\/g2-icp-home.*\$GITHUB_ENV/);
  assert.ok(workflow.indexOf('ICP_HOME=$RUNNER_TEMP') < workflow.indexOf('icp identity import'));
});
test('manual upgrade is protected and serialized with existing mainnet deployment', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: group-2-owner-opening/);
  assert.match(workflow, /group: ignite-mainnet-governor-deployment/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /secrets\.DEPLOYER_PEM/);
  assert.match(workflow, /icp-cli@1\.7\.0/);
  assert.doesNotMatch(workflow, /identity new|cycles mint|icp deploy|install-group-closed/);
});
test('explicit confirmation is checked before any upgrade', () => {
  assert.ok(runner.indexOf("CONFIRMATION?.trim() !== 'UPGRADE GROUP 2'") < runner.indexOf("spawnSync('icp'"));
  assert.match(runner, /validateGroup2Inventory\(provision, shared\)/);
  assert.match(runner, /read_owner_test_deletion_required/);
});
test('durable GitHub intent readback precedes the upgrade call', () => {
  assert.match(runner, /group-2-upgrade-receipts/);
  assert.ok(runner.indexOf("step.phase = 'pending'; persist();") < runner.indexOf("spawnSync('icp'"));
  assert.match(runner, /stored = persistGroup2Journal\(api, path, branch, stored, journal, 'upgrade'\)/);
  assert.match(runner, /reconcileUpgradeStep\(step, before.moduleHash\)/);
  assert.match(runner, /journal.routerRevision !== revision/);
});
test('upgrades cannot change settings or open the group and always remove signing keys', () => {
  assert.match(runner, /after.settingsHash !== step.settingsHash/);
  assert.doesNotMatch(runner, /open_owner_test_group\(|update_settings\(|register_group\(|enable_stable_media_storage\(/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /rm -f "\$RUNNER_TEMP\/g2-operator.pem"/);
});
test('PII attestation is preserved in durable progress before upgrading', () => {
  assert.match(runner, /keyReceipt: JSON.parse\(readFileSync\(keyFile\)\)/);
  assert.match(runner, /else writeFileSync\(keyFile, JSON.stringify\(journal.keyReceipt\)\)/);
  assert.ok(runner.indexOf("keyGate('after');") < runner.indexOf("spawnSync('icp'"));
});test('reload only reinstalls identical modules, behind its own confirmation and durable intent', () => {
  assert.match(workflow, /options: \[check, upgrade, reload\]/);
  assert.match(workflow, /RELOAD GROUP 2 SETTINGS/);
  assert.match(runner, /CONFIRMATION\?\.trim\(\) !== 'RELOAD GROUP 2 SETTINGS'/);
  const reload = runner.slice(runner.indexOf("if (action === 'reload') {\n"));
  assert.ok(reload.indexOf('Reload refused: the staged') < reload.indexOf("spawnSync('icp'"));
  assert.ok(reload.indexOf("step.phase = 'pending'; persist();") < reload.indexOf("spawnSync('icp'"));
  assert.match(reload, /before.settingsHash !== step.settingsHash/);
  assert.match(reload, /after.settingsHash !== step.settingsHash/);
  assert.match(reload, /verifyUpgradeStatus\(plan, after, GROUP2_GOVERNOR, plan.newHash\)/);
  assert.match(reload, /stored = persistGroup2Journal\(api, path, branch, stored, journal, 'reload'\)/);
});
test('resume after the eleventh saved completion reloads only timers and photo store', async () => {
  const names = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain',
    'club_points_domain', 'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue',
    'pii_access_control', 'timer_jobs', 'media_blob_store'];
  const journal = { steps: names.map((name, i) => ({ name, phase: i < 11 ? 'complete' : 'ready', settingsHash: 'settings' })) };
  const reload = runner.slice(runner.indexOf("if (action === 'reload') {\n"));
  const loop = reload.slice(reload.indexOf('  for (const plan of plans) {'), reload.indexOf("\n  keyGate('after');\n  if (await closed()"));
  const installed = [];
  let savedPhase;
  await vm.runInNewContext(`(async () => { ${loop} })()`, {
    plans: names.map(name => ({ name, newHash: 'module', file: name })), journal, revision: '1',
    closed: async () => '1', observe: async () => ({ moduleHash: 'module', settingsHash: 'settings' }),
    persist: () => { savedPhase = journal.steps.find(s => s.phase === 'pending')?.name; },
    upgradeArgs: plan => [plan.name], GROUP2_GOVERNOR: 'governor', reportDirectory: '/tmp',
    spawnSync: (_command, args) => {
      assert.equal(savedPhase, args[0]); installed.push(args[0]); return { status: 0 };
    }, verifyUpgradeStatus: () => {}, keyGate: () => {}, console: { log: () => {} },
  });
  assert.deepEqual(installed, ['timer_jobs', 'media_blob_store']);
  assert.equal(journal.steps.filter(s => s.phase === 'complete').length, 13);
});
