import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRunIds, controllersFrom, assertRemovable } from './remove-media-test-stores-policy.mjs';

const deployPrincipal = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
const receipt = { canisterId: '2knbe-saaaa-aaaal-qxpua-cai', binding: { runId: 'media-mixed-001', governor: deployPrincipal } };
const ok = { runId: 'media-mixed-001', receipt, controllers: [deployPrincipal], deployPrincipal, protectedIds: new Set() };

test('accepts only the run’s own solely-controlled test store', () => {
  assert.equal(assertRemovable(ok), '2knbe-saaaa-aaaal-qxpua-cai');
});
test('refuses live/group services', () => {
  assert.throws(() => assertRemovable({ ...ok, protectedIds: new Set([receipt.canisterId]) }), /live or group/);
});
test('refuses extra controllers or another creator', () => {
  assert.throws(() => assertRemovable({ ...ok, controllers: [deployPrincipal, 'aaaaa-aa'] }), /other controllers/);
  assert.throws(() => assertRemovable({ ...ok, receipt: { ...receipt, binding: { ...receipt.binding, governor: 'x' } } }), /deploy key/);
});
test('refuses receipts for other runs or without a store', () => {
  assert.throws(() => assertRemovable({ ...ok, runId: 'media-tiny-001' }), /another run/);
  assert.throws(() => assertRemovable({ ...ok, receipt: { binding: receipt.binding } }), /never created/);
});
test('ids are limited to photo-store tests', () => {
  assert.deepEqual(parseRunIds('media-mixed-001, media-tiny-001'), ['media-mixed-001', 'media-tiny-001']);
  assert.throws(() => parseRunIds('club-domain'), /Not a photo-store/);
  assert.throws(() => parseRunIds(''), /1–5/);
});
test('controller list is read from nested JSON', () => {
  assert.deepEqual(controllersFrom({ settings: { controllers: [deployPrincipal] } }), [deployPrincipal]);
  assert.throws(() => controllersFrom({}), /exactly one/);
});
test('workflow is manual, confirmed, serialized and always recovers fuel', () => {
  const wf = readFileSync(new URL('../.github/workflows/remove-media-test-stores.yml', import.meta.url), 'utf8');
  assert.match(wf, /workflow_dispatch:/); assert.doesNotMatch(wf, /schedule:/);
  assert.match(wf, /DELETE TEST STORES/);
  assert.match(wf, /group: ignite-mainnet-governor-deployment/);
  const runner = readFileSync(new URL('./remove-media-test-stores.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runner, /no-recover-cycles/);
  assert.match(runner, /removal = \{ phase: 'removing'/);
});
