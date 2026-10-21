import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpeningWorker } from '../frontend/scripts/opening-worker.mjs';

const worker = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
const other = 'mq2sj-fiaaa-aaaal-qxlqa-cai';
test('missing approval worker resolves to the configured existing delivery identity', () => {
  assert.equal(resolveOpeningWorker(undefined, worker), worker);
});
test('recorded approval and existing delivery identity must agree', () => {
  assert.equal(resolveOpeningWorker(worker, worker), worker);
  assert.throws(() => resolveOpeningWorker(worker, other), /differs/);
});
test('missing and invalid identities fail closed', () => {
  assert.throws(() => resolveOpeningWorker(undefined, undefined), /worker missing/);
  for (const invalid of ['2vxsx-fae', 'aaaaa-aa', 'not-a-principal']) {
    assert.throws(() => resolveOpeningWorker(undefined, invalid), /Invalid/);
  }
});
test('a recorded approval remains usable without runtime worker configuration', () => {
  assert.equal(resolveOpeningWorker(worker, undefined), worker);
});