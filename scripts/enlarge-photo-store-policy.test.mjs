import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capacityBytesFor, assertEnlargeConfirmation } from './enlarge-photo-store-policy.mjs';

test('enlargement confirmation accepts surrounding whitespace but requires the exact phrase', () => {
  assert.doesNotThrow(() => assertEnlargeConfirmation('ENLARGE GROUP 1 PHOTO STORE'));
  assert.doesNotThrow(() => assertEnlargeConfirmation(' \tENLARGE GROUP 1 PHOTO STORE\r\n'));
  assert.doesNotThrow(() => assertEnlargeConfirmation('\u00a0ENLARGE GROUP 1 PHOTO STORE\u00a0'));
  for (const value of [undefined, '', 'ENLARGE GROUP 2 PHOTO STORE', 'enlarge group 1 photo store', 'ENLARGE GROUP 1 PHOTO  STORE']) {
    assert.throws(() => assertEnlargeConfirmation(value));
  }
});

test('sizes are whole GiB within the 200 GiB configured ceiling', () => {
  assert.equal(capacityBytesFor('10'), 10_737_418_240n);
  assert.equal(capacityBytesFor('32'), 34_359_738_368n);
  assert.equal(capacityBytesFor('64'), 68_719_476_736n);
  assert.equal(capacityBytesFor('200'), 214_748_364_800n);
  assert.throws(() => capacityBytesFor('201'));
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
