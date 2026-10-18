import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshotBytes, equalSnapshotBytes } from './media-snapshot-reader.mjs';
const request = { canisterId: 'canister-one', snapshotId: 'abcd', deploymentId: 'deployment-one', host: 'https://icp-api.io', subnetId: 'subnet-one', registryRevision: 'r1' };
function fixture() {
  const m = { source: { taken_from_canister: null }, globals: [{ i32: 1 }], certified_data: [], global_timer: [], on_low_wasm_memory_hook_status: [],
    wasm_chunk_store: [], wasm_module_size: 2n, wasm_memory_size: 1_000_001n, stable_memory_size: 2n, taken_at_timestamp: 1n, canister_version: 1n };
  const reads = [];
  const transport = { verifyStoppedPlacement: async () => true, readMetadata: async () => structuredClone(m),
    readData: async (r, kind) => { reads.push(kind); const range = Object.values(kind)[0]; return Buffer.alloc(Number(range.size), 'wasm_memory' in kind ? 2 : 1); } };
  return { m, reads, transport };
}
test('reads every module, heap and stable byte in bounded management ranges', async () => {
  const f = fixture(); const a = await readSnapshotBytes(request, f.transport);
  assert.equal(a.components.wasm_memory.bytes, '1000001');
  assert.deepEqual(f.reads.filter(r => r.wasm_memory).map(r => r.wasm_memory), [{ offset: 0n, size: 1_000_000n }, { offset: 1_000_000n, size: 1n }]);
  const b = await readSnapshotBytes({ ...request, snapshotId: 'eeee' }, f.transport);
  assert.equal(equalSnapshotBytes(a, b), true);
});
test('denies unsupported API, short reads and changed placement or running state', async () => {
  for (const mutate of [f => f.transport.readMetadata = async () => { throw new Error('unsupported'); },
    f => f.transport.readData = async () => Buffer.alloc(1), f => f.transport.verifyStoppedPlacement = async () => false]) {
    const f = fixture(); mutate(f); await assert.rejects(readSnapshotBytes(request, f.transport));
  }
  const f = fixture(); let checks = 0; f.transport.verifyStoppedPlacement = async () => ++checks < 3;
  await assert.rejects(readSnapshotBytes(request, f.transport));
});
test('operator size budget rejects before memory reads and uploaded metadata is denied', async () => {
  const f = fixture(); await assert.rejects(readSnapshotBytes(request, f.transport, { maxBytes: 10n }), /budget/); assert.equal(f.reads.length, 0);
  f.m.source = { metadata_upload: null }; await assert.rejects(readSnapshotBytes(request, f.transport), /evidence/);
});
test('changed heap, stable, module, globals and deployment do not compare equal', async () => {
  const f = fixture(); const baseline = await readSnapshotBytes(request, f.transport);
  for (const kind of ['wasm_module', 'wasm_memory', 'stable_memory']) {
    const g = fixture(); const read = g.transport.readData;
    g.transport.readData = async (r, k) => { const b = await read(r, k); if (kind in k) b[0] ^= 1; return b; };
    assert.equal(equalSnapshotBytes(baseline, await readSnapshotBytes(request, g.transport)), false, kind);
  }
  const g = fixture(); g.m.globals[0].i32 = 2;
  assert.equal(equalSnapshotBytes(baseline, await readSnapshotBytes(request, g.transport)), false);
  assert.equal(equalSnapshotBytes(baseline, await readSnapshotBytes({ ...request, deploymentId: 'other' }, f.transport)), false);
});
test('metadata mutation during read is rejected', async () => {
  const f = fixture(); let reads = 0; const read = f.transport.readMetadata;
  f.transport.readMetadata = async () => { const m = await read(); if (++reads > 1) m.stable_memory_size = 3n; return m; };
  await assert.rejects(readSnapshotBytes(request, f.transport), /evidence/);
});
test('missing destination bindings and malformed matching evidence fail closed', async () => {
  for (const k of ['canisterId', 'deploymentId', 'host', 'subnetId', 'registryRevision']) {
    const bad = { ...request }; delete bad[k];
    await assert.rejects(readSnapshotBytes(bad, fixture().transport), /evidence/);
  }
  assert.equal(equalSnapshotBytes({ version: 1, request }, { version: 1, request }), false);
});
