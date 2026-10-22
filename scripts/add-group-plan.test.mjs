import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STEPS, confirmed, chooseGroup, nextGroupId, startOrResume, remainingSteps, markDone, openingRecord, admissionTargets, retryable, settingsNeedReload } from './add-group-plan.mjs';

const SHA = 'a'.repeat(40), SHA2 = 'b'.repeat(40);

test('confirmation is short and forgiving about spaces and case only', () => {
  assert.ok(confirmed('ADD GROUP')); assert.ok(confirmed('  add group ')); assert.ok(!confirmed('ADD GROUPS')); assert.ok(!confirmed(''));
});
test('next group id follows the highest known group; g1 is never chosen', () => {
  assert.equal(nextGroupId(['g2']), 'g3'); assert.equal(nextGroupId([]), 'g2'); assert.equal(nextGroupId(['g2', 'g10', 'x']), 'g11');
});
test('auto resumes the single unfinished group, explicit ids are validated', () => {
  assert.equal(chooseGroup('auto', { g3: { completed: [] } }, ['g2', 'g3']), 'g3');
  assert.equal(chooseGroup('auto', { g3: { finishedAt: 'x' } }, ['g2', 'g3']), 'g4');
  assert.throws(() => chooseGroup('auto', { g3: {}, g4: {} }, ['g3', 'g4']), /Several unfinished/);
  assert.throws(() => chooseGroup('g1', {}, []), /g1 is the original/);
  assert.equal(chooseGroup(' G5 ', {}, []), 'g5');
});
test('a finished group is never re-run and code changes mid-install are refused', () => {
  assert.throws(() => startOrResume({ groupId: 'g3', finishedAt: 'x', completed: STEPS }, 'g3', SHA, 'now'), /already added/);
  assert.throws(() => startOrResume({ groupId: 'g3', release: SHA, completed: ['support'] }, 'g3', SHA2, 'now'), /same commit/);
  assert.equal(startOrResume({ groupId: 'g3', release: SHA, completed: ['support', 'install'] }, 'g3', SHA2, 'now').release, SHA2);
  assert.throws(() => startOrResume(null, 'g3', 'nope', 'now'), /release binding/);
});
test('resume skips finished steps and the last step finishes the run', () => {
  let p = startOrResume(null, 'g3', SHA, 'now');
  assert.deepEqual(remainingSteps(p), STEPS);
  for (const s of STEPS.slice(0, 3)) p = markDone(p, s, 't');
  assert.equal(remainingSteps(p)[0], 'register');
  for (const s of STEPS) p = markDone(p, s, 'end');
  assert.equal(p.finishedAt, 'end'); assert.deepEqual(remainingSteps(p), []);
});
test('steps open the group only after account access and full checks, and approve last', () => {
  const at = s => STEPS.indexOf(s);
  assert.ok(at('install') < at('register') && at('settings') < at('reload') && at('reload') < at('settings-loaded'));
  assert.ok(at('hashes') < at('admission') && at('admission') < at('check') && at('check') < at('open') && at('open') < at('approve'));
  assert.equal(STEPS.at(-1), 'approve');
});
test('opening record uses mainnet pins and the installed subnet', () => {
  const r = openingRecord('g3', { groupId: 'g3', phase: 'checked', subnetId: 'sub' }, { shard_router: 'r', identity_access: 'i', secret_workload_identity: 'w' });
  assert.equal(r.groupId, 'g3'); assert.equal(r.primarySubnet, 'sub'); assert.equal(r.provisionFile, '../deploy/groups/g3/provision.json');
  assert.equal(r.maxClubs, 100); assert.deepEqual(r.services, []);
  assert.throws(() => openingRecord('g3', { groupId: 'g3', phase: 'installed', subnetId: 's' }, {}), /Installed and checked/);
});
test('admission targets are exactly 11 domains plus the photo store', () => {
  const p = t => ({ toText: () => t });
  const domains = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
  const group = { id: 'g3', domains: domains.map(d => ({ domain: d, canister: p(`c-${d}`) })), photo_store: [p('store')] };
  assert.equal(admissionTargets(group, domains).length, 12);
  assert.throws(() => admissionTargets({ ...group, photo_store: [] }, domains), /12/);
});
test('only known idempotent conditions retry; unknown outcomes never do', () => {
  assert.ok(retryable('reload', 'Registry changed; stop reload'));
  assert.ok(retryable('open', 'Registry changed before open'));
  assert.ok(!retryable('open', 'Unknown outcome; registry changed'));
  assert.ok(!retryable('install', 'Registry changed'));
  assert.ok(settingsNeedReload('... (SETTINGS_NOT_LOADED) ...'));
});
test('workflow is one click, serialized and saves progress even after a stop', () => {
  const yml = readFileSync(new URL('../.github/workflows/add-group.yml', import.meta.url), 'utf8');
  assert.match(yml, /group: ignite-mainnet-governor-deployment/);
  assert.match(yml, /default: auto/);
  assert.match(yml, /node scripts\/add-group\.mjs/);
  assert.match(yml, /name: Save progress\n\s+if: always\(\)/);
  assert.doesNotMatch(yml, /--force|reinstall/);
});
