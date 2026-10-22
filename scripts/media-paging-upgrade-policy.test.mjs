import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRequest, validateTargets, runBackfill, PINNED } from './media-paging-upgrade-policy.mjs';
const targets = Object.entries(PINNED).map(([groupId, canisterId]) => ({ canisterId, groupId, name: 'media_metadata', subnetId: 'subnet', newHash: 'b'.repeat(64) }));
test('requires photo-only approval and exactly the two existing media_metadata canisters', () => {
  validateRequest('upgrade', ' UPGRADE BOTH GROUPS PHOTOS\n'); validateRequest('check', '');
  assert.throws(() => validateRequest('upgrade', 'UPGRADE BOTH GROUPS CHATS'));
  validateTargets(targets);
  assert.throws(() => validateTargets([...targets, targets[0]]));
  assert.throws(() => validateTargets(targets.map(t => ({ ...t, name: 'media_blob_store' }))));
  assert.throws(() => validateTargets([targets[1], targets[1]]));
});
test('repository mappings match the pinned photo services', () => {
  const root = new URL('../', import.meta.url);
  const shared = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json', root)));
  const provision = JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json', root)));
  assert.equal(shared.media_metadata, PINNED.g1); assert.equal(provision.canisters.media_metadata, PINNED.g2);
});
test('backfill resumes across transient failures until both groups report complete', async () => {
  const left = { g1: 3, g2: 1 }; let flaky = true;
  const done = await runBackfill(['g1', 'g2'], async g => {
    if (g === 'g2' && flaky) { flaky = false; throw new Error('timeout'); }
    left[g]--; return { Ok: { scanned: 200, complete: left[g] <= 0 } };
  });
  assert.deepEqual(done, { g1: true, g2: true });
});
test('backfill stops on refusal', async () => {
  await assert.rejects(() => runBackfill(['g1'], async () => ({ Err: 'Governor required' })), /refused/);
});
