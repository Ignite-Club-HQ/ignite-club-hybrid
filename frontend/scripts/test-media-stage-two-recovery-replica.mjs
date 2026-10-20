import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { drainTestUploads, reconcileFill } from './media-stage-two-recovery.mjs';
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const stranger = Principal.fromUint8Array(new Uint8Array([2, 1]));
const prefix = 'users/network-test/media-mixed-001/';
const oldWasm = '/tmp/media-stage-two-before.wasm';
const wasm = resolve(import.meta.dirname, '../../backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const ok = r => { assert.ok('Ok' in r, String(r.Err)); return r.Ok; };
const digest = size => createHash('sha256').update(Buffer.alloc(size, size % 251)).digest('hex');
const server = await PocketIcServer.start({ binPath: '/root/.cache/mops/pocket-ic/15.0.0/pocket-ic' });
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const fixture = await pic.setupCanister({ idlFactory, wasm: oldWasm, sender: governor, controllers: [governor], environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }, { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' }] });
  const a = fixture.actor; a.setPrincipal(governor);
  ok(await a.enable_stable_media_storage());
  const size = 1024;
  for (const index of [0, 2, 39]) {
    const id = ok(await a.begin_upload(prefix + index, 'application/octet-stream', BigInt(size), 1));
    ok(await a.put_chunk(id, 0, Buffer.alloc(size, size % 251))); ok(await a.finalize_upload(id));
  }
  const pending = ok(await a.begin_upload(prefix + '1', 'application/octet-stream', BigInt(size), 1));
  ok(await a.put_chunk(pending, 0, Buffer.alloc(size)));
  assert.equal((await a.begin_upload(prefix + '1', 'application/octet-stream', BigInt(size), 1)).Err, 'Upload already in progress for path');
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  a.setPrincipal(stranger); assert.equal((await a.read_pending_test_uploads(prefix)).Err, 'Governor required');
  a.setPrincipal(governor); assert.ok('Err' in await a.read_pending_test_uploads('clubs/c/'));
  const rows = ok(await a.read_pending_test_uploads(prefix)); assert.equal(rows[0].id, pending);
  const events = [];
  assert.equal(await drainTestUploads({ actor: a, prefix, sizes: [size], max: 40, saveIntent: async r => events.push(r.id), saveReceipt: async r => events.push(r.id) }), 1);
  assert.deepEqual(events, [pending, pending]);
  const rebuilt = await reconcileFill({ actor: a, prefix, sizes: [size], max: 40, digest });
  assert.equal(Object.keys(rebuilt).length, 3);
  const next = ok(await a.begin_upload(prefix + '1', 'application/octet-stream', BigInt(size), 1));
  ok(await a.put_chunk(next, 0, Buffer.alloc(size, size % 251))); ok(await a.finalize_upload(next));
  assert.equal((await a.get_usage()).total_bytes, 4096n);
  // A foreign unfinished path prevents cleanup even on an isolated fixture.
  ok(await a.begin_upload('users/foreign/unfinished', 'application/octet-stream', 1n, 1));
  assert.ok('Err' in await a.read_pending_test_uploads(prefix));
  console.log('PASS actual old-module upgrade: pending IDs preserved, governor-only inventory, abort/re-upload, hashes/totals and foreign-path refusal');
} finally { if (pic) await pic.tearDown(); await server.stop(); }