import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runRecoveryAction } from './media-recovery-receipts.mjs';

const expected = { deploymentId: 'engine-one', authority: 'authority', stores: ['store-one', 'store-two'] };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ignite-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const states = new Map([...expected.stores, expected.authority].map(id => [id, 'running']));
  const calls = [];
  const adapter = {
    readInventory: async () => expected,
    stop: async id => { calls.push(`stop:${id}`); states.set(id, 'stopped'); },
    status: async id => states.get(id),
    takeSnapshot: async () => 'abcd',
    loadSnapshot: async id => { calls.push(`load:${id}`); },
    start: async id => { calls.push(`start:${id}`); states.set(id, 'running'); },
    verifyConsistency: async () => true,
  };
  const run = (action, approved) => runRecoveryAction(directory, expected, adapter, action, approved);
  const disk = async () => JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
  return { directory, states, calls, adapter, run, disk };
}

test('disk reload preserves complete checkpoint and acknowledges every snapshot', async t => {
  const f = await fixture(t); await f.run('checkpoint');
  const saved = await f.disk();
  assert.equal(saved.phase, 'checkpointed');
  assert.equal(saved.steps.filter(s => s.method === 'takeSnapshot' && s.state === 'acknowledged' && s.snapshotId === 'abcd').length, 3);
  await f.run('restore'); await f.run('resume', true);
  assert.equal((await f.disk()).phase, 'resumed');
  assert.deepEqual(f.calls.filter(c => c.startsWith('start:')), ['start:authority', 'start:store-one', 'start:store-two']);
});
test('partial restore on disk blocks resume and full replay restores every participant', async t => {
  const f = await fixture(t); await f.run('checkpoint');
  const load = f.adapter.loadSnapshot;
  f.adapter.loadSnapshot = async id => { if (id === 'store-two') throw new Error('Interrupted'); await load(id); };
  await assert.rejects(f.run('restore'), /Interrupted/);
  assert.equal((await f.disk()).phase, 'restore_failed');
  await assert.rejects(f.run('resume', true), /Resume requires/);
  assert.equal(f.calls.some(c => c.startsWith('start:')), false);
  f.adapter.loadSnapshot = load; f.calls.length = 0;
  await f.run('restore');
  assert.deepEqual(f.calls.filter(c => c.startsWith('load:')), ['load:store-one', 'load:store-two', 'load:authority']);
});
test('crash-phase receipt cannot be treated as a complete restore', async t => {
  const f = await fixture(t); await f.run('checkpoint');
  const saved = await f.disk(); saved.phase = 'restoring';
  await writeFile(join(f.directory, 'receipt.json'), JSON.stringify(saved));
  await assert.rejects(f.run('resume', true), /Resume requires/);
  await f.run('restore'); assert.equal((await f.disk()).phase, 'restored');
});
test('exclusive lock blocks concurrent or crashed operators before mutation', async t => {
  const f = await fixture(t); await writeFile(join(f.directory, 'operator.lock'), '');
  await assert.rejects(f.run('checkpoint'), /Recovery locked/); assert.deepEqual(f.calls, []);
});
test('actual process exit preserves restore intent and blocks resume until manual investigation', async t => {
  const f = await fixture(t); await f.run('checkpoint');
  const script = `
    import { runRecoveryAction } from ${JSON.stringify(new URL('./media-recovery-receipts.mjs', import.meta.url).href)};
    const expected = ${JSON.stringify(expected)};
    const adapter = { readInventory: async () => expected, stop: async () => {},
      status: async () => 'stopped', loadSnapshot: async () => process.exit(42) };
    await runRecoveryAction(${JSON.stringify(f.directory)}, expected, adapter, 'restore');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 10000 });
  assert.equal(child.status, 42);
  const saved = await f.disk();
  assert.equal(saved.phase, 'restoring');
  assert.equal(saved.steps.at(-1).method, 'loadSnapshot');
  assert.equal(saved.steps.at(-1).state, 'attempted');
  await assert.rejects(f.run('resume', true), /Recovery locked/);
  // Test-only manual unlock after confirming the child is dead.
  await rm(join(f.directory, 'operator.lock'));
  await assert.rejects(f.run('resume', true), /Resume requires/);
  await f.run('restore'); assert.equal((await f.disk()).phase, 'restored');
});
test('corrupt and cross-deployment receipts fail before mutation', async t => {
  const f = await fixture(t); await f.run('checkpoint'); const saved = await f.disk(); f.calls.length = 0;
  await writeFile(join(f.directory, 'receipt.json'), '{');
  await assert.rejects(f.run('restore'), SyntaxError);
  saved.inventory.deploymentId = 'other-engine';
  await writeFile(join(f.directory, 'receipt.json'), JSON.stringify(saved));
  await assert.rejects(f.run('restore'), /mismatched/); assert.deepEqual(f.calls, []);
});
test('failed restart refences all participants and requires full restore before retry', async t => {
  const f = await fixture(t); await f.run('checkpoint'); await f.run('restore');
  const start = f.adapter.start;
  f.adapter.start = async id => { if (id === 'store-two') throw new Error('Start failed'); await start(id); };
  await assert.rejects(f.run('resume', true), /Start failed/);
  assert.deepEqual([...f.states.values()], ['stopped', 'stopped', 'stopped']);
  assert.equal((await f.disk()).phase, 'resume_failed');
  await assert.rejects(f.run('resume', true), /Resume requires/);
});
test('receipt persistence failure after a start refences without trusting storage and retains lock', async t => {
  const f = await fixture(t); await f.run('checkpoint'); await f.run('restore');
  const start = f.adapter.start;
  f.adapter.start = async id => {
    await start(id);
    await rm(join(f.directory, 'receipt.json'));
    // A directory cannot be atomically replaced with a receipt file.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(f.directory, 'receipt.json'));
  };
  await assert.rejects(f.run('resume', true));
  assert.deepEqual([...f.states.values()], ['stopped', 'stopped', 'stopped']);
  await assert.rejects(f.run('restore'), /Recovery locked/);
});
test('resume never bypasses explicit approval or consistency failure', async t => {
  const f = await fixture(t); await f.run('checkpoint');
  await assert.rejects(f.run('resume', false), /approval/);
  f.adapter.verifyConsistency = async () => false;
  await assert.rejects(f.run('resume', true), /consistency/);
  assert.equal(f.calls.some(c => c.startsWith('start:')), false);
});