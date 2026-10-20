// Minimum isolated regression: no paid network, no production capacity changes.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const wasm = resolve('backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const oldWasm = process.env.MEDIA_PREVIOUS_WASM;
if (!oldWasm) throw new Error('MEDIA_PREVIOUS_WASM must name the saved previous (64 GiB) module for the upgrade test');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const other = Principal.fromUint8Array(new Uint8Array([2, 1]));
const ok = result => { assert.ok('Ok' in result, String(result.Err)); return result.Ok; };
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/root/.cache/mops/pocket-ic/15.0.0/pocket-ic' });
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const f = await pic.setupCanister({ idlFactory, wasm: oldWasm, sender: governor, controllers: [governor], environmentVariables: [
    { name: 'GOVERNOR_PRINCIPAL', value: governor.toText() },
    { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' },
  ] });
  const a = f.actor; a.setPrincipal(governor);
  assert.ok('Err' in await a.set_capacity_limit(34_359_738_368n));
  ok(await a.enable_stable_media_storage());
  ok(await a.set_capacity_limit(34_359_738_368n));
  assert.ok('Err' in await a.set_capacity_limit(214_748_364_800n), 'previous 64 GiB module must reject 200 GiB');
  a.setPrincipal(other);
  assert.ok('Err' in await a.set_capacity_limit(1_000n));
  a.setPrincipal(governor);
  const path = 'users/minimum/committed';
  const committed = ok(await a.begin_upload(path, 'application/octet-stream', 8n, 1));
  ok(await a.put_chunk(committed, 0, Buffer.from('original')));
  ok(await a.finalize_upload(committed));
  const pending = ok(await a.begin_upload('users/minimum/pending', 'application/octet-stream', 1_000_008n, 2));
  ok(await a.put_chunk(pending, 0, Buffer.alloc(1_000_000, 7)));
  const allocation = (await a.stable_storage_status()).allocated_bytes;
  await pic.upgradeCanister({ canisterId: f.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.equal((await a.get_usage()).capacity_limit_bytes, 34_359_738_368n);
  ok(await a.set_capacity_limit(214_748_364_800n));
  assert.equal((await a.get_usage()).capacity_limit_bytes, 214_748_364_800n);
  assert.ok('Err' in await a.set_capacity_limit(214_748_364_801n));
  a.setPrincipal(other);
  assert.ok('Err' in await a.set_capacity_limit(214_748_364_800n));
  a.setPrincipal(governor);
  await pic.upgradeCanister({ canisterId: f.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.equal((await a.get_usage()).capacity_limit_bytes, 214_748_364_800n);
  assert.equal((await a.get_usage()).total_bytes, 8n);
  assert.equal((await a.stable_storage_status()).allocated_bytes, allocation);
  const response = await a.http_request({ url: '/' + path, method: 'GET', headers: [], body: [] });
  assert.equal(response.status_code, 200);
  assert.equal(Buffer.from(response.body).toString(), 'original');
  ok(await a.put_chunk(pending, 1, Buffer.from('finished')));
  ok(await a.finalize_upload(pending));
  assert.equal((await a.get_usage()).total_bytes, 1_000_016n);
  const finalizedAllocation = (await a.stable_storage_status()).allocated_bytes;
  assert.equal(finalizedAllocation, 2_097_152n);
  ok(await a.delete_blob('users/minimum/pending'));
  assert.equal((await a.get_usage()).total_bytes, 8n);
  const cancelled = ok(await a.begin_upload('users/minimum/abort', 'application/octet-stream', 1_000_008n, 2));
  ok(await a.abort_upload(cancelled));
  const retry = ok(await a.begin_upload('users/minimum/retry', 'application/octet-stream', 1_000_008n, 2));
  assert.equal((await a.stable_storage_status()).allocated_bytes, finalizedAllocation);
  ok(await a.abort_upload(retry));
  assert.equal((await a.get_usage()).total_bytes, 8n);
  console.log('PASS: real 64-to-200 GiB candidate upgrade, unchanged old capacity until explicit enlargement, 200 GiB persistence, above-ceiling/unauthorized rejection, committed and pending bytes, abort/reuse and exact totals. Local evidence, not live acceptance.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}