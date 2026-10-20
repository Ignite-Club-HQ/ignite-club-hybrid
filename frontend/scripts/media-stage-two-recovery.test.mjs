import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryBinding, drainTestUploads, reconcileFill, settledBatch, ORIGINAL_MODULE, RECOVERY_MODULE, RECOVERY_TARGET } from './media-stage-two-recovery.mjs';
const prefix = 'users/network-test/media-mixed-001/';
const sizes = [1048576, 2097152, 409600, 4194304, 8388608, 2097152];
test('only the approved interrupted target accepts matching recovery settings', () => {
  const binding = { runId: 'media-mixed-001', scenario: 'mixed', budgetCycles: '5000000000000', wasmSha256: ORIGINAL_MODULE };
  const saved = { canisterId: RECOVERY_TARGET, binding }, next = { ...binding, wasmSha256: RECOVERY_MODULE };
  assert.deepEqual(recoveryBinding(saved, next), binding);
  assert.equal(recoveryBinding({ ...saved, canisterId: 'live-cai' }, next), null);
  assert.equal(recoveryBinding(saved, { ...next, budgetCycles: '3000000000000' }), null);
  assert.throws(() => recoveryBinding(saved, { ...next, wasmSha256: 'b'.repeat(64) }), /Unapproved recovery build/);
  assert.throws(() => recoveryBinding({ ...saved, recoveryUpdate: { to: 'c'.repeat(64) } }, next));
});
test('unjournaled pending IDs are recovered without losing 256 finalized files', async () => {
  let pending = [{ id: 'upload-259', path: prefix + '256', size: 8388608n }];
  const events = [];
  const actor = {
    read_pending_test_uploads: async () => ({ Ok: pending }),
    abort_upload: async id => { events.push(['abort', id]); pending = []; return { Ok: null }; },
    get_content_hash: async path => Number(path.slice(prefix.length)) < 256 ? ['hash-' + sizes[Number(path.slice(prefix.length)) % sizes.length]] : [],
    get_usage: async () => ({ total_bytes: 773636096n }), health: async () => ({ blob_count: 256n }),
  };
  assert.equal(await drainTestUploads({ actor, prefix, sizes, max: 4000, saveIntent: async r => events.push(['intent', r.id]), saveReceipt: async r => events.push(['receipt', r.id]) }), 1);
  assert.deepEqual(events.map(e => e[0]), ['intent', 'abort', 'receipt']);
  const objects = await reconcileFill({ actor, prefix, sizes, max: 4000, digest: size => 'hash-' + size });
  assert.equal(Object.keys(objects).length, 256);
  assert.equal(objects[prefix + '256'], undefined);
});
test('validate whole pending inventory before any abort', async () => {
  for (const bad of [{ id: 'x', path: 'clubs/c/photo', size: 1n }, { id: 'x', path: prefix + '256', size: 1n }, { id: 'x', path: prefix + 'smoke', size: 1n }, { id: 'first', path: prefix + '1', size: 2097152n }]) {
    let aborted = false;
    const actor = { read_pending_test_uploads: async () => ({ Ok: [{ id: 'first', path: prefix + '0', size: 1048576n }, bad] }), abort_upload: async () => { aborted = true; } };
    await assert.rejects(drainTestUploads({ actor, prefix, sizes, max: 4000, saveIntent: async () => {}, saveReceipt: async () => {} }));
    assert.equal(aborted, false);
  }
});
test('lost abort reply stops; next resume reads absence rather than replaying ID', async () => {
  let rows = [{ id: 'x', path: prefix + '0', size: 1048576n }], calls = 0;
  const actor = { read_pending_test_uploads: async () => ({ Ok: rows }), abort_upload: async () => { calls++; rows = []; throw new Error('reply lost'); } };
  const deps = { actor, prefix, sizes, max: 4000, saveIntent: async () => {}, saveReceipt: async () => {} };
  await assert.rejects(drainTestUploads(deps), /reply lost/);
  assert.equal(await drainTestUploads(deps), 0); assert.equal(calls, 1);
});
test('scan holes and long gaps; reject unknown stored bytes', async () => {
  const actor = { get_content_hash: async path => [0, 2, 39].includes(Number(path.slice(prefix.length))) ? ['same'] : [], get_usage: async () => ({ total_bytes: 3n }), health: async () => ({ blob_count: 3n }) };
  const objects = await reconcileFill({ actor, prefix, sizes: [1], max: 40, digest: () => 'same' });
  assert.deepEqual(Object.keys(objects), [prefix + '0', prefix + '2', prefix + '39']);
  actor.get_usage = async () => ({ total_bytes: 4n });
  await assert.rejects(reconcileFill({ actor, prefix, sizes: [1], max: 40, digest: () => 'same' }));
});
test('failed concurrent batch waits for all completions before checkpoint', async () => {
  let finished = false;
  await assert.rejects(settledBatch([Promise.reject(new Error('busy')), new Promise(resolve => setTimeout(() => { finished = true; resolve(true); }, 20))]), /busy/);
  assert.equal(finished, true);
});