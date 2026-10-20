// Bounded real allocator/workload measurements. Never mainnet evidence.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wasm = resolve(root, 'backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const ok = result => { assert.ok('Ok' in result, JSON.stringify(result, (_, v) => typeof v === "bigint" ? String(v) : v)); return result.Ok; };
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/tmp/pocket-ic' });
try {
  const pic = await PocketIc.create(server.getUrl());
  const environmentVariables = [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }, { name: 'IGNITE_MEDIA_SLOT_LOCAL_REHEARSAL', value: '1' }];
  const fixture = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables });
  const a = fixture.actor; a.setPrincipal(governor);
  ok(await a.enable_stable_media_storage());
  // 16 MiB physical ceiling allows a real bounded allocator-exhaustion test.
  ok(await a.set_capacity_limit(16_777_216n));
  const startFuel = await pic.getCyclesBalance(fixture.canisterId);
  const baseline = await a.memory_stats();
  const timings = []; const sizes = [40_000, 200_000, 400_000, 1_100_000, 2_100_000];
  const expected = new Map();
  async function upload(path, size) {
    const bytes = Buffer.alloc(size, size % 251); const start = performance.now();
    const chunks = Math.ceil(size / 1_000_000);
    const id = ok(await a.begin_upload(path, 'application/octet-stream', BigInt(size), chunks));
    for (let chunk = 0; chunk < chunks; chunk++) ok(await a.put_chunk(id, chunk, bytes.subarray(chunk * 1_000_000, (chunk + 1) * 1_000_000)));
    const result = ok(await a.finalize_upload(id));
    assert.equal(result.content_hash, createHash('sha256').update(bytes).digest('hex'));
    timings.push(performance.now() - start); expected.set(path, size);
  }
  // Hold all four owner slots before sending chunks. A fifth request cannot
  // borrow the same tail; the four accepted uploads survive an upgrade.
  ok(await a.set_capacity_limit(2_097_152n));
  const held = [];
  for (let n = 0; n < 4; n++) held.push(ok(await a.begin_upload(`users/pending/${n}`, 'application/octet-stream', 400_000n, 1)));
  assert.equal((await a.stable_storage_status()).allocated_bytes, 2_097_152n);
  const capacity = ok(await a.read_physical_growth_capacity());
  assert.equal(capacity.pending_count, 4n);
  assert.equal(capacity.pending_slot_bytes, 2_097_152n);
  assert.equal(capacity.legacy_pending_count, 0n);
  assert.equal(capacity.allocatable_object_slots, 0n);
  a.setPrincipal(Principal.fromUint8Array(new Uint8Array([9, 1])));
  assert.ok('Err' in await a.read_physical_growth_capacity());
  a.setPrincipal(governor);
  assert.ok('Err' in await a.begin_upload('users/pending/overflow', 'application/octet-stream', 1n, 1));
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  // A lower limit closes new admissions but cannot steal already held extents.
  ok(await a.set_capacity_limit(1n));
  for (const id of held) { ok(await a.put_chunk(id, 0, Buffer.alloc(400_000, 6))); ok(await a.finalize_upload(id)); }
  assert.equal(ok(await a.read_physical_growth_capacity()).pending_slot_bytes, 0n);
  for (let n = 0; n < 4; n++) ok(await a.delete_blob(`users/pending/${n}`));
  ok(await a.set_capacity_limit(2_097_152n));
  const aborted = ok(await a.begin_upload('users/pending/abort', 'application/octet-stream', 400_000n, 1));
  ok(await a.abort_upload(aborted));
  assert.ok('Err' in await a.abort_upload(aborted));
  const retry = ok(await a.begin_upload('users/pending/retry', 'application/octet-stream', 400_000n, 1));
  ok(await a.abort_upload(retry));
  ok(await a.set_capacity_limit(16_777_216n));
  // Mixed image/file sizes, overwrite churn, and same-class freed-slot reuse.
  for (let round = 0; round < 3; round++) {
    for (let index = 0; index < sizes.length; index++) await upload(`users/load/${index}`, sizes[index]);
    const allocated = (await a.stable_storage_status()).allocated_bytes;
    for (let index = 0; index < sizes.length; index++) { ok(await a.delete_blob(`users/load/${index}`)); expected.delete(`users/load/${index}`); }
    for (let index = 0; index < sizes.length; index++) await upload(`users/load/${index}`, sizes[index]);
    assert.equal((await a.stable_storage_status()).allocated_bytes, allocated, 'same-class churn must reuse slots');
    for (let index = 0; index < sizes.length; index++) { ok(await a.delete_blob(`users/load/${index}`)); expected.delete(`users/load/${index}`); }
  }
  // Fill with 400 KB ciphertext. Physical power-of-two slots, not payload
  // bytes, eventually refuse admission before the logical threshold.
  let count = 0;
  while (count < 100) {
    const path = `users/fill/${count}`;
    const result = await a.begin_upload(path, 'application/octet-stream', 400_000n, 1);
    if ('Err' in result) break;
    ok(await a.put_chunk(result.Ok, 0, Buffer.alloc(400_000, 8)));
    const finalized = await a.finalize_upload(result.Ok);
    if ('Err' in finalized) { ok(await a.abort_upload(result.Ok)); break; }
    expected.set(path, 400_000); count++;
  }
  assert.equal(count, 32, 'freed mixed-size slots must split/coalesce into all 32 available 512 KiB slots');
  const status = await a.stable_storage_status(); const usage = await a.get_usage();
  assert.ok(status.allocated_bytes <= 16_777_216n);
  assert.equal(usage.total_bytes, BigInt([...expected.values()].reduce((sum, size) => sum + size, 0)));
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.equal((await a.stable_storage_status()).allocated_bytes, status.allocated_bytes);
  for (const path of expected.keys()) assert.ok((await a.get_content_hash(path)).length);
  const finalFuel = await pic.getCyclesBalance(fixture.canisterId);
  const memory = await a.memory_stats(); timings.sort((x, y) => x - y);
  const report = { environment: 'isolated-pocketic', productionCapacityProven: false, configuredBytes: 16_777_216, successfulFillObjects: count, physicalBytes: status.allocated_bytes.toString(), payloadBytes: usage.total_bytes.toString(), baseline, memory, simulatedCyclesSpent: (startFuel - finalFuel).toString(), uploadSamples: timings.length, uploadMedianMs: timings[Math.floor(timings.length / 2)], uploadP95Ms: timings[Math.floor(timings.length * 0.95)], limitations: ['Bounded 16 MiB allocator test; not full-volume 32 GiB acceptance.', 'Local wall times and simulated cycles are not mainnet throughput or costs.', 'No deployment limits were changed.'] };
  writeFileSync('/tmp/media-capacity-workload.json', JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  console.log('PASS: mixed-size churn, physical exhaustion, exact totals, hash read-back and upgrade; report /tmp/media-capacity-workload.json');
} finally { await server.stop(); }