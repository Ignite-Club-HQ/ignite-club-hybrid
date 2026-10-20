// Frozen previous module -> additive multi-Region actor upgrade. Local only.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wasm = resolve(root, 'backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const previous = process.env.MEDIA_PREVIOUS_WASM;
if (!previous) throw new Error('MEDIA_PREVIOUS_WASM must identify the saved pre-multi-Region module');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const other = Principal.fromUint8Array(new Uint8Array([2, 1]));
const ok = r => { assert.ok('Ok' in r, String(r.Err)); return r.Ok; };
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/root/.cache/mops/pocket-ic/15.0.0/pocket-ic' });
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const fixture = await pic.setupCanister({ idlFactory, wasm: previous, sender: governor, controllers: [governor], environmentVariables: [
    { name: 'GOVERNOR_PRINCIPAL', value: governor.toText() },
    { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' },
    { name: 'IGNITE_MEDIA_SLOT_LOCAL_REHEARSAL', value: '1' },
  ] });
  const a = fixture.actor; a.setPrincipal(governor);
  ok(await a.enable_stable_media_storage());
  ok(await a.set_capacity_limit(68_719_476_736n));
  const path = 'users/multi/old';
  const old = ok(await a.begin_upload(path, 'application/octet-stream', 8n, 1));
  ok(await a.put_chunk(old, 0, Buffer.from('original')));
  ok(await a.finalize_upload(old));
  const pending = ok(await a.begin_upload('users/multi/pending', 'application/octet-stream', 1_000_008n, 2));
  ok(await a.put_chunk(pending, 0, Buffer.alloc(1_000_000, 7)));
  const allocation = (await a.stable_storage_status()).allocated_bytes;
  for (let step = 0; step < 2; step++) {
    await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    assert.equal((await a.get_usage()).capacity_limit_bytes, 68_719_476_736n);
    assert.equal((await a.stable_storage_status()).allocated_bytes, allocation);
    assert.equal((await a.get_usage()).total_bytes, 8n);
    const read = await a.http_request({ url: '/' + path, method: 'GET', headers: [], body: [] });
    assert.equal(read.status_code, 200);
    assert.equal(Buffer.from(read.body).toString(), 'original');
    assert.ok('Err' in await a.set_capacity_limit(536_870_912_000n), '500 GiB must remain unavailable on the pinned RTS');
    a.setPrincipal(other);
    assert.ok('Err' in await a.set_capacity_limit(68_719_476_736n));
    a.setPrincipal(governor);
  }
  ok(await a.put_chunk(pending, 1, Buffer.from('finished')));
  ok(await a.finalize_upload(pending));
  assert.equal((await a.get_usage()).total_bytes, 1_000_016n);
  const large = await a.http_request({ url: '/users/multi/pending', method: 'GET', headers: [], body: [] });
  assert.equal(large.body.length, 1_000_000);
  const token = large.streaming_strategy[0]?.Callback.token;
  assert.ok(token);
  assert.equal(Buffer.from((await a.http_request_streaming_callback(token)).body).toString(), 'finished');
  ok(await a.delete_blob('users/multi/pending'));
  const retry = ok(await a.begin_upload('users/multi/retry', 'application/octet-stream', 1_000_008n, 2));
  assert.equal((await a.stable_storage_status()).allocated_bytes, allocation);
  ok(await a.abort_upload(retry));
  assert.equal((await a.get_usage()).total_bytes, 8n);
  console.log('PASS: frozen prior actor -> additive upgrade twice; old ciphertext, pending physical slot/chunks, streaming, deletion/reuse and exact totals preserved; unauthorized/500 GiB refused.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}