import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capacityBytesFor } from './enlarge-photo-store-policy.mjs';

test('sizes are whole GB within the 32 GB store ceiling', () => {
  assert.equal(capacityBytesFor('10'), 10_737_418_240n);
  assert.equal(capacityBytesFor('32'), 34_359_738_368n);
  assert.throws(() => capacityBytesFor('33'));
  assert.throws(() => capacityBytesFor('2'));
  assert.throws(() => capacityBytesFor('5.5'));
});
test('Group 1 store deploys with the larger-storage setting', () => {
  assert.match(readFileSync(new URL('../backend/media_blob_store/canister.yaml', import.meta.url), 'utf8'), /IGNITE_MEDIA_LARGE_CAPACITY: "1"/);
});
test('new groups install their photo store in larger mode', () => {
  const s = readFileSync(new URL('../frontend/scripts/install-group-closed.ts', import.meta.url), 'utf8');
  assert.match(s, /IGNITE_MEDIA_LARGE_CAPACITY/);
  assert.match(s, /enable_stable_media_storage/);
});
