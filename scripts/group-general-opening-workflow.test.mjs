import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { transformWithEsbuild } = frontendRequire('vite');
const workflow = readFileSync(new URL('../.github/workflows/open-group-general.yml', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../frontend/scripts/set-group-service-settings.ts', import.meta.url), 'utf8');
const snapshot = readFileSync(new URL('../frontend/scripts/produce-routing-gates.ts', import.meta.url), 'utf8');
const opening = readFileSync(new URL('../frontend/scripts/open-group-general.ts', import.meta.url), 'utf8');

test('opening scripts transform cleanly (catches duplicate declarations before GitHub)', async () => {
  for (const [name, source] of [['set-group-service-settings.ts', settings], ['produce-routing-gates.ts', snapshot],
    ['open-group-general.ts', opening],
    ['report-group-health.ts', readFileSync(new URL('../frontend/scripts/report-group-health.ts', import.meta.url), 'utf8')],
    ['stop-group-placements.ts', readFileSync(new URL('../frontend/scripts/stop-group-placements.ts', import.meta.url), 'utf8')]]) {
    const result = await transformWithEsbuild(source, name).catch(e => { throw new Error(`${name}: ${e.message}`); });
    assert.ok(result?.code.length > 0, name);
  }
});

test('settings startup accepts the workflow arguments without accessing the later report object', async () => {
  const { code } = await transformWithEsbuild(settings, 'set-group-service-settings.ts');
  const startup = code.slice(code.indexOf('const [groupIdsArg'), code.indexOf('const ids ='));
  assert.ok(startup.length > 0);
  runInNewContext(`${startup}\nconst report = {};`, {
    process: { argv: ['node', 'settings', 'g2', '/tmp/operator.pem', '/tmp/settings-report.json'],
      env: { CONFIRMATION: 'SET SERVICE SETTINGS' } },
  });
});

test('settings startup rejects a missing report path before any identity or network access', async () => {
  const { code } = await transformWithEsbuild(settings, 'set-group-service-settings.ts');
  const startup = code.slice(code.indexOf('const [groupIdsArg'), code.indexOf('const ids ='));
  assert.ok(startup.length > 0);
  assert.throws(() => runInNewContext(`${startup}\nconst report = {};`, {
    process: { argv: ['node', 'settings', 'g2', '/tmp/operator.pem'],
      env: { CONFIRMATION: 'SET SERVICE SETTINGS' } },
  }), /Usage: set-group-service-settings/);
});

test('settings, snapshot and stop read the real root mappings regardless of workflow working folder', () => {
  const expected = JSON.parse(readFileSync(new URL('../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
  for (const name of ['set-group-service-settings.ts', 'produce-routing-gates.ts', 'stop-group-placements.ts']) {
    const scriptUrl = new URL(`../frontend/scripts/${name}`, import.meta.url);
    const source = readFileSync(scriptUrl, 'utf8');
    const declaration = source.match(/^const ids = .+;$/m)?.[0];
    assert.ok(declaration, name);
    for (const cwd of [new URL('../', import.meta.url).pathname, new URL('../frontend/', import.meta.url).pathname]) {
      const actual = runInNewContext(`${declaration.replaceAll('import.meta.url', 'scriptUrl')}\nids`, {
        URL, scriptUrl: scriptUrl.href, readFileSync, resolve: (...parts) => resolve(cwd, ...parts),
      });
      assert.equal(actual.shard_router, expected.shard_router, `${name}: ${cwd}`);
      assert.equal(actual.identity_access, expected.identity_access, `${name}: ${cwd}`);
    }
  }
});

test('manual opening workflow is protected and serialized with existing mainnet deployment', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: group-2-admin-controls/);
  assert.match(workflow, /group: ignite-mainnet-governor-deployment/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /secrets\.DEPLOYER_PEM/);
  assert.doesNotMatch(workflow, /identity new|cycles mint|icp deploy|icp canister install/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /rm -f "\$RUNNER_TEMP\/operator\.pem"/);
});

test('approvals must be committed under deploy/groups/g2', () => {
  assert.match(workflow, /deploy\/groups\/g2\/\*\.json/);
});

test('settings runner requires exact confirmation before any mutation', () => {
  assert.ok(settings.indexOf("CONFIRMATION?.trim() !== 'SET SERVICE SETTINGS'") < settings.indexOf('update_settings'));
  assert.match(settings, /readPinnedGroupRegistry/);
});

test('settings bind identity first, verify, then switch the admission flag, then the creator binding', () => {
  assert.ok(settings.indexOf("phase: 'identity-binding'") < settings.indexOf("phase: 'admission-flag'"));
  assert.ok(settings.indexOf("phase: 'admission-flag'") < settings.indexOf("phase: 'creator-binding'"));
  assert.match(settings, /new Map\(\(await envOf/);
  assert.match(settings, /readback failed/);
  assert.match(settings, /environment_variables is a replace-all setting/);
});

test('snapshot is governor-verified, wired to removal proof, and writes the committed frontend file', () => {
  assert.match(snapshot, /Existing deployment administrator required/);
  assert.match(snapshot, /verifyRemovalWiring/);
  assert.match(snapshot, /verifyOwnerReciprocalConfiguration/);
  assert.match(snapshot, /src\/live\/generated\/routingGates\.ts/);
  assert.match(snapshot, /evidenceSha256/);
  assert.match(snapshot, /registryRevision: String\(registry\.revision\)/);
});

test('snapshot hashes and emits lossless Nat64 removal revisions in both output files', async () => {
  const { code } = await transformWithEsbuild(snapshot, 'produce-routing-gates.ts');
  const emission = code.slice(code.indexOf('const generatedAt ='));
  assert.ok(emission.startsWith('const generatedAt ='));
  const revision = 18446744073709551615n;
  const files = new Map();
  runInNewContext(emission.replaceAll('import.meta.url', 'scriptUrl'), {
    createHash, URL, scriptUrl: new URL('../frontend/scripts/produce-routing-gates.ts', import.meta.url).href,
    registry: { revision, configurationRevision: revision, groups: [], placements: [] },
    groupApprovalConfiguration: () => "approved-config", host: 'https://icp-api.io', routerId: 'jcdfe-vqaaa-aaaal-qxloq-cai',
    snapshotGroups: [{ id: 'g2', domains: [], photoStore: 'store', moduleHashes: {} }],
    wiring: { evidence: { revision, groupIds: ['g2'], checkedAtMs: 1792612440000 } },
    report: 'report.json', saveJson: (path, value) => files.set(path, JSON.stringify(value)),
    saveFile: (path, value) => files.set(path, value), console: { log() {} },
  });
  const report = JSON.parse(files.get('report.json'));
  assert.equal(report.routerCanisterId, 'jcdfe-vqaaa-aaaal-qxloq-cai');
  assert.equal(report.registryRevision, '18446744073709551615');
  assert.equal(report.configurationRevision, '18446744073709551615');
  assert.equal(report.approvedConfiguration, 'approved-config');
  assert.equal(report.removalWiring.revision, '18446744073709551615');
  assert.equal(report.removalWiring.checkedAtMs, 1792612440000);
  const generated = files.get(new URL('../frontend/src/live/generated/routingGates.ts', import.meta.url).pathname);
  const emitted = JSON.parse(generated.slice(generated.indexOf(' = ') + 3).trim().replace(/;$/, ''));
  assert.deepEqual(emitted, report);
  const { approved, targetAlias, host, routerCanisterId, evidenceSha256, ...evidence } = emitted;
  assert.equal(evidenceSha256, createHash('sha256').update(JSON.stringify(evidence)).digest('hex'));
  assert.equal(BigInt(emitted.removalWiring.revision), revision);
});

test('opening runner confirms every mutation behind its exact phrase before any register call', () => {
  const firstRegister = opening.indexOf('router.register_group');
  assert.ok(firstRegister > 0);
  // Phrases are templated by group (Group 2 keeps the exact original wording).
  for (const phrase of ['`OPEN ${UPPER} TO EVERYONE`', '`CLOSE ${UPPER} TO NEW CLUBS`', '`REGISTER ${UPPER} CLOSED`']) {
    const at = opening.indexOf(phrase);
    assert.ok(at > -1 && at < firstRegister, phrase);
  }
  assert.match(opening, /reconcile manually/);
});

test('opening refuses an already-open group and requires recorded fingerprints', () => {
  assert.match(opening, /already open; run close first/);
  assert.match(opening, /no recorded module fingerprints/);
  assert.match(opening, /is already open`\)/);
  assert.match(opening, /ADD_GROUP_RESUME === '1'/);
});

test('open requires removal wiring for every registered group before flipping admission', () => {
  assert.match(opening, /Removal wiring incomplete; fix before opening/);
  assert.match(opening, /verifyOwnerOpeningChecks\(spec, observed, group, placement\)/);
  assert.match(opening, /record_group_health\(GROUP, largestHeap, lowestCycles/);
  assert.match(opening, /const GROUP = spec\.groupId \?\? 'g2'/);
});

test('committed g2 approval budgets fit the router limits (heap 1..3 GiB, cycles > 0, clubs 1..100000)', () => {
  const approval = JSON.parse(readFileSync(new URL('../deploy/groups/g2/general-opening.json', import.meta.url), 'utf8'));
  const router = readFileSync(new URL('../backend/shard_router/src/groups.rs', import.meta.url), 'utf8');
  assert.match(router, /heap_budget_bytes > 3 \* 1024 \* 1024 \* 1024/);
  assert.match(router, /MAX_CLUBS: u32 = 100_000/);
  const heap = BigInt(approval.heapBudgetBytes);
  assert.ok(heap > 0n && heap <= 3n * 1024n ** 3n, `heapBudgetBytes ${heap}`);
  assert.ok(BigInt(approval.minCycles) > 0n);
  assert.ok(approval.maxClubs > 0 && approval.maxClubs <= 100_000);
  assert.ok(BigInt(approval.deploymentRevision) >= 1n, 'router rejects placement revision 0');
  assert.match(readFileSync(new URL('../backend/shard_router/src/discovery.rs', import.meta.url), 'utf8'), /p\.deployment_revision == 0/);
  assert.ok(opening.indexOf('Approval budgets outside router limits') < opening.indexOf('router.register_group('));
});

test('register-closed resumes a half-registered group by adding only the placement', () => {
  const resume = opening.indexOf("'placement-resume'");
  assert.ok(resume > 0 && resume < opening.indexOf('router.register_group(group'));
  assert.match(opening, /Incomplete group placement registry/);
});

test('the commit step saves the approval even before the snapshot file exists', () => {
  const yml = readFileSync(new URL('../.github/workflows/open-group-general.yml', import.meta.url), 'utf8');
  assert.match(yml, /git add deploy\/groups\/g2\/general-opening\.json\n/);
  assert.match(yml, /if \[ -f frontend\/src\/live\/generated\/routingGates\.ts \]; then git add/);
  assert.doesNotMatch(yml, /git add deploy\/groups\/g2\/general-opening\.json frontend/);
});

test('checks and snapshots resolve the existing delivery identity rather than accepting the first grant', () => {
  assert.match(workflow, /secrets\.ICP_PUSH_WORKER_SEED/);
  assert.match(workflow, /run: bash scripts\/resolve-group-push-worker\.sh/);
  for (const source of [opening, snapshot]) assert.match(source, /resolveOpeningWorker\(.+process\.env\.PUSH_WORKER_PRINCIPAL/);
  assert.doesNotMatch(snapshot, /pushWorker: worker|queue\.filter/);
});
