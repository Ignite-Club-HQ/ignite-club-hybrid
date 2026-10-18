// Isolated PocketIC integration: build canister first; never mainnet.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wasm = resolve(root, 'backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const owner = Principal.fromUint8Array(new Uint8Array([2, 1]));
const other = Principal.fromUint8Array(new Uint8Array([3, 1]));
const ok = result => { assert.ok('Ok' in result, JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v)); return result.Ok; };
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const fixture = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] });
  const actor = fixture.actor;
  actor.setPrincipal(owner);
  async function upload(path, bytes) {
    const id = ok(await actor.begin_upload(path, 'application/octet-stream', BigInt(bytes.length), Math.max(1, Math.ceil(bytes.length / 1_000_000))));
    for (let i = 0; i < Math.max(1, Math.ceil(bytes.length / 1_000_000)); i++) ok(await actor.put_chunk(id, i, bytes.slice(i * 1_000_000, (i + 1) * 1_000_000)));
    const result = ok(await actor.finalize_upload(id));
    assert.equal(result.content_hash, createHash('sha256').update(bytes).digest('hex'));
    return result;
  }
  async function download(path) {
    const response = await actor.http_request({ url: `/${path}?v=1`, method: 'GET', headers: [], body: [] });
    assert.equal(response.status_code, 200);
    const parts = [Buffer.from(response.body)];
    let strategy = response.streaming_strategy[0];
    let token = strategy?.Callback.token;
    while (token) {
      const part = await actor.http_request_streaming_callback(token);
      assert.ok(part.body.length <= 1_000_000);
      parts.push(Buffer.from(part.body)); token = part.token[0];
    }
    return Buffer.concat(parts);
  }
  const path = 'users/u/ciphertext.bin';
  const bytes = Buffer.alloc(2_100_007); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  await upload(path, bytes);
  assert.deepEqual(await download(path), bytes);
  actor.setPrincipal(other);
  assert.ok('Err' in await actor.migrate_legacy_blob());
  assert.ok('Err' in await actor.delete_blob(path));
  assert.ok('Err' in await actor.begin_upload(path, 'application/octet-stream', 1n, 1));
  actor.setPrincipal(governor);
  assert.ok('Err' in await actor.enable_stable_media_storage());
  const migration = ok(await actor.migrate_legacy_blob());
  assert.equal(migration.remaining, 0n);
  assert.equal(migration.copied_bytes, BigInt(bytes.length));
  assert.equal(ok(await actor.migrate_legacy_blob()).copied_bytes, 0n);
  assert.deepEqual(await download(path), bytes);
  ok(await actor.enable_stable_media_storage());
  actor.setPrincipal(owner);
  const replacement = Buffer.from('encrypted replacement');
  await upload(path, replacement);
  assert.deepEqual(await download(path), replacement);
  const allocated = (await actor.stable_storage_status()).allocated_bytes;
  ok(await actor.delete_blob(path));
  await upload(path, replacement);
  assert.equal((await actor.stable_storage_status()).allocated_bytes, allocated, 'deleted slots must be reused');
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { wasm_memory_persistence: [{ keep: null }] } });
  assert.deepEqual(await download(path), replacement);
  assert.equal((await actor.stable_storage_status()).enabled, true);
  assert.equal((await actor.health()).total_bytes, BigInt(replacement.length));
  const response = await actor.http_request({ url: '/missing', method: 'GET', headers: [], body: [] });
  assert.equal(response.status_code, 404);
  console.log('PASS: authenticated upload, streaming read-back, migration integrity/idempotency, owner denial, replacement/delete/reuse and EOP upgrade preservation.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}