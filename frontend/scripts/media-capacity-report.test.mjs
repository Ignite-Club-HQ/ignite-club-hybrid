import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCapacityResults } from './media-capacity-report.mjs';
test('preserves same-build completed scenarios', () => {
  assert.deepEqual(mergeCapacityResults({ environment: 'isolated-pocketic', wasmSha256: 'a', results: [{ name: 'mixed', files: 1417 }] }, [{ name: 'tiny', files: 8192 }], 'a'), [{ name: 'mixed', files: 1417 }, { name: 'tiny', files: 8192 }]);
});
test('rejects other builds', () => {
  assert.deepEqual(mergeCapacityResults({ environment: 'isolated-pocketic', wasmSha256: 'old', results: [{ name: 'mixed' }] }, [], 'new'), []);
});
test('rejects other environments', () => {
  assert.deepEqual(mergeCapacityResults({ environment: 'mainnet', wasmSha256: 'a', results: [{ name: 'mixed' }] }, [], 'a'), []);
});
test('replaces rerun scenario', () => {
  assert.deepEqual(mergeCapacityResults({ environment: 'isolated-pocketic', wasmSha256: 'a', results: [{ name: 'tiny', files: 1 }] }, [{ name: 'tiny', files: 8192 }], 'a'), [{ name: 'tiny', files: 8192 }]);
});