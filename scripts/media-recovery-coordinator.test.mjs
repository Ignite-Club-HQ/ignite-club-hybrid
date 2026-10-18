import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpointMedia, restoreMedia, resumeMedia } from './media-recovery-coordinator.mjs';
const expected = { deploymentId: 'engine-one', authority: 'authority', stores: ['store-one', 'store-two'] };
function fixture() {
  const calls = [];
  const statuses = new Map(['authority', 'store-one', 'store-two'].map(id => [id, 'running']));
  const adapter = {
    readInventory: async () => expected,
    stop: async id => { calls.push(`stop:${id}`); statuses.set(id, 'stopped'); },
    start: async id => { calls.push(`start:${id}`); statuses.set(id, 'running'); },
    status: async id => statuses.get(id),
    takeSnapshot: async id => { calls.push(`take:${id}`); return 'abcd'; },
    loadSnapshot: async id => { calls.push(`load:${id}`); },
    verifyConsistency: async () => true,
  };
  return { adapter, calls, statuses };
}
test('checkpoints all stores and authority only after every participant is stopped', async () => {
  const f = fixture(); const saved = await checkpointMedia(expected, f.adapter);
  assert.deepEqual(f.calls, ['stop:store-one', 'stop:store-two', 'stop:authority', 'take:store-one', 'take:store-two', 'take:authority']);
  assert.equal(saved.snapshots.length, 3);
  assert.deepEqual([...f.statuses.values()], ['stopped', 'stopped', 'stopped']);
});
test('rejects omitted registered stores before stopping or taking snapshots', async () => {
  const f = fixture();
  await assert.rejects(checkpointMedia({ ...expected, stores: ['store-one'] }, f.adapter), /authoritative registry/);
  assert.deepEqual(f.calls, []);
});
test('rejects cross-engine checkpoints despite identical canister names', async () => {
  const f = fixture(); const saved = await checkpointMedia(expected, f.adapter); f.calls.length = 0;
  await assert.rejects(restoreMedia({ ...expected, deploymentId: 'engine-two' }, saved, f.adapter), /authoritative registry/);
  assert.deepEqual(f.calls, []);
});
test('rejects partial and duplicate snapshot manifests before any mutation', async () => {
  const f = fixture(); const saved = await checkpointMedia(expected, f.adapter); f.calls.length = 0;
  for (const snapshots of [saved.snapshots.slice(1), [saved.snapshots[0], saved.snapshots[0], saved.snapshots[2]]]) {
    await assert.rejects(restoreMedia(expected, { ...saved, snapshots }, f.adapter), /coordinated snapshots/);
    assert.deepEqual(f.calls, []);
  }
});
test('failed stop prevents every snapshot and never automatically restarts writers', async () => {
  const f = fixture(); const stop = f.adapter.stop;
  f.adapter.stop = async id => { if (id === 'store-two') throw new Error('Outstanding call'); await stop(id); };
  await assert.rejects(checkpointMedia(expected, f.adapter), /Outstanding call/);
  assert.deepEqual(f.calls, ['stop:store-one']);
});
test('snapshot failure leaves all participants stopped', async () => {
  const f = fixture(); f.adapter.takeSnapshot = async () => { throw new Error('Snapshot rejected'); };
  await assert.rejects(checkpointMedia(expected, f.adapter), /Snapshot rejected/);
  assert.deepEqual([...f.statuses.values()], ['stopped', 'stopped', 'stopped']);
});
test('partial restore failure never starts any participant', async () => {
  const f = fixture(); const saved = await checkpointMedia(expected, f.adapter); f.calls.length = 0;
  f.adapter.loadSnapshot = async id => { f.calls.push(`load:${id}`); if (id === 'store-two') throw new Error('Restore rejected'); };
  await assert.rejects(restoreMedia(expected, saved, f.adapter), /Restore rejected/);
  assert.equal(f.calls.some(call => call.startsWith('start:')), false);
  assert.deepEqual([...f.statuses.values()], ['stopped', 'stopped', 'stopped']);
});
test('resume requires explicit approval and verified consistency', async () => {
  const f = fixture(); const saved = await checkpointMedia(expected, f.adapter); f.calls.length = 0;
  await assert.rejects(resumeMedia(expected, saved, f.adapter, false), /approval/);
  f.adapter.verifyConsistency = async () => false;
  await assert.rejects(resumeMedia(expected, saved, f.adapter, true), /consistency/);
  assert.deepEqual(f.calls, []);
});
test('resume starts authority before either writer', async () => {
  const f = fixture(); const saved = await checkpointMedia(expected, f.adapter); f.calls.length = 0;
  await restoreMedia(expected, saved, f.adapter); f.calls.length = 0;
  await resumeMedia(expected, saved, f.adapter, true);
  assert.deepEqual(f.calls, ['start:authority', 'start:store-one', 'start:store-two']);
});
test('failed writer start refences all participants', async () => {
  const f = fixture(); const saved = await checkpointMedia(expected, f.adapter); f.calls.length = 0;
  const start = f.adapter.start;
  f.adapter.start = async id => { if (id === 'store-two') throw new Error('Start rejected'); await start(id); };
  await assert.rejects(resumeMedia(expected, saved, f.adapter, true), /Start rejected/);
  assert.deepEqual(f.calls.slice(-3), ['stop:store-one', 'stop:store-two', 'stop:authority']);
  assert.deepEqual([...f.statuses.values()], ['stopped', 'stopped', 'stopped']);
});
test('inventory change after fencing blocks checkpoint creation', async () => {
  const f = fixture(); let reads = 0;
  f.adapter.readInventory = async () => ++reads === 1 ? expected : { ...expected, stores: [...expected.stores, 'new-store'] };
  await assert.rejects(checkpointMedia(expected, f.adapter), /authoritative registry/);
  assert.equal(f.calls.some(call => call.startsWith('take:')), false);
});