import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecoverySnapshotVerification } from './media-recovery-snapshots.mjs';
import { runRecoveryAction } from './media-recovery-receipts.mjs';

const inv = { deploymentId: 'local', authority: 'quota', stores: ['store-a', 'store-b'] };
const placement = { deploymentId: 'local', network: 'replica', host: 'https://replica.invalid', registryRevision: 'r1',
  subnets: { quota: 's1', 'store-a': 's1', 'store-b': 's2' } };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-snapshots-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const states = new Map(['store-a', 'store-b', 'quota'].map(id => [id, 'running']));
  const values = new Map([...states.keys()].map(id => [id, 7]));
  const snapshots = new Map(); const starts = []; let n = 0;
  const adapter = {
    readInventory: async () => structuredClone(inv), verifyRecoveryPlacement: async p => JSON.stringify(p) === JSON.stringify(placement),
    status: async id => states.get(id), stop: async id => states.set(id, 'stopped'),
    start: async id => { starts.push(id); states.set(id, 'running'); },
    takeSnapshot: async id => { const key = (++n).toString(16).padStart(4, '0'); snapshots.set(key, { id, value: values.get(id) }); return key; },
    loadSnapshot: async (id, key) => values.set(id, snapshots.get(key).value),
    verifyConsistency: async () => true,
  };
  const transport = {
    verifyStoppedPlacement: async r => states.get(r.canisterId) === 'stopped' && r.subnetId === placement.subnets[r.canisterId],
    readMetadata: async () => ({ source: { taken_from_canister: null }, globals: [], certified_data: [], global_timer: [],
      on_low_wasm_memory_hook_status: [], wasm_chunk_store: [], wasm_module_size: 1n, wasm_memory_size: 1n,
      stable_memory_size: 1n, taken_at_timestamp: 1n, canister_version: 1n }),
    readData: async r => Buffer.from([snapshots.get(r.snapshotId).value]),
  };
  const verification = createRecoverySnapshotVerification(inv, placement, adapter, transport);
  const run = (action, approved = false, v = verification) => runRecoveryAction(directory, inv, adapter, action, approved, v);
  const disk = async () => JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
  return { directory, states, values, snapshots, starts, adapter, transport, verification, run, disk };
}
test('durable baseline and fresh restored observations survive reload before approved authority-first resume', async t => {
  const f = await fixture(t); await f.run('checkpoint');
  const baseline = await f.disk();
  assert.equal(baseline.snapshotBaseline.participants.length, 3);
  assert.equal(baseline.steps.filter(s => s.method === 'readSnapshotBytes' && s.state === 'acknowledged' && s.evidence).length, 3);
  f.values.set('store-a', 9); await f.run('restore');
  assert.equal(f.values.get('store-a'), 7);
  const restored = await f.disk();
  assert.notEqual(restored.snapshotObservation.participants[0].request.snapshotId, baseline.snapshotBaseline.participants[0].request.snapshotId);
  await f.run('resume', true);
  assert.deepEqual(f.starts, ['quota', 'store-a', 'store-b']);
});
test('evidence-required receipt rejects omitted verifier before starts', async t => {
  const f = await fixture(t); await f.run('checkpoint');
  await assert.rejects(runRecoveryAction(f.directory, inv, f.adapter, 'resume', true), /adapter required/);
  assert.deepEqual(f.starts, []);
});
test('missing duplicate malformed or cross-deployment baselines reject before any restore mutation', async t => {
  const f = await fixture(t); await f.run('checkpoint'); const original = await f.disk();
  let loads = 0; f.adapter.loadSnapshot = async () => { loads++; };
  for (const change of [r => r.snapshotBaseline.participants.pop(),
    r => r.snapshotBaseline.participants[1] = r.snapshotBaseline.participants[0],
    r => delete r.snapshotBaseline.participants[0].components,
    r => r.snapshotBaseline.placement.network = 'other',
    r => r.snapshotBaseline.participants[0].request.snapshotId = 'ffff']) {
    const r = structuredClone(original); change(r);
    await writeFile(join(f.directory, 'receipt.json'), JSON.stringify(r));
    await assert.rejects(f.run('restore'), /evidence/);
  }
  assert.equal(loads, 0); assert.deepEqual(f.starts, []);
});
test('changed raw state blocks resume even when semantic adapter returns true', async t => {
  const f = await fixture(t); await f.run('checkpoint'); f.values.set('store-b', 8);
  await assert.rejects(f.run('resume', true), /bytes differ/);
  assert.deepEqual(f.starts, []); assert.ok([...f.states.values()].every(s => s === 'stopped'));
  assert.equal((await f.disk()).phase, 'resume_failed');
});
test('unchanged raw state never bypasses the separate semantic gate', async t => {
  const f = await fixture(t); await f.run('checkpoint'); f.adapter.verifyConsistency = async () => false;
  await assert.rejects(f.run('resume', true), /consistency/); assert.deepEqual(f.starts, []);
});
test('whole-set running status during another participant read fails and refences all', async t => {
  const f = await fixture(t); const read = f.transport.readData;
  f.transport.readData = async r => { f.states.set('store-b', 'running'); return read(r); };
  await assert.rejects(f.run('checkpoint'), /evidence/);
  assert.ok([...f.states.values()].every(s => s === 'stopped'));
  assert.equal((await f.disk()).phase, 'checkpoint_failed');
  await assert.rejects(f.run('resume', true), /evidence/);
});
test('inventory or placement drift mid-read leaves an incomplete checkpoint and no starts', async t => {
  for (const kind of ['inventory', 'placement']) {
    const f = await fixture(t); const read = f.transport.readData;
    f.transport.readData = async r => {
      if (kind === 'inventory') f.adapter.readInventory = async () => ({ ...inv, stores: ['store-a'] });
      else f.adapter.verifyRecoveryPlacement = async () => false;
      return read(r);
    };
    await assert.rejects(f.run('checkpoint'), /evidence/); assert.deepEqual(f.starts, []);
  }
});
test('size budget and unsupported reads cannot produce a resumable checkpoint', async t => {
  for (const kind of ['budget', 'unsupported']) {
    const f = await fixture(t);
    const v = createRecoverySnapshotVerification(inv, placement, f.adapter, f.transport, { maxBytes: kind === 'budget' ? 1n : 10n });
    if (kind === 'unsupported') f.transport.readMetadata = async () => { throw new Error('Unsupported'); };
    await assert.rejects(f.run('checkpoint', false, v));
    assert.equal((await f.disk()).phase, 'checkpoint_failed'); assert.deepEqual(f.starts, []);
  }
});
test('raw byte observations cannot upgrade a legacy receipt without a new checkpoint', async t => {
  const f = await fixture(t);
  await runRecoveryAction(f.directory, inv, f.adapter, 'checkpoint');
  await assert.rejects(f.run('resume', true), /Legacy receipt/); assert.deepEqual(f.starts, []);
});
test('invalid deployment destinations reject before controller calls', async t => {
  const f = await fixture(t);
  for (const p of [{ ...placement, host: 'http://replica.invalid' }, { ...placement, network: '' },
    { ...placement, subnets: { quota: 's1' } }, { ...placement, deploymentId: 'other' }]) {
    assert.throws(() => createRecoverySnapshotVerification(inv, p, f.adapter, f.transport), /evidence/);
  }
  assert.equal(f.snapshots.size, 0);
});