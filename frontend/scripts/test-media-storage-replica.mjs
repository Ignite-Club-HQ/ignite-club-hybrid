// Isolated PocketIC integration: build canister first; never mainnet.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
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
  const bytes = Buffer.alloc(10_551_296); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
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
  const stale = await actor.http_request_streaming_callback({ path, content_hash: createHash('sha256').update(bytes).digest('hex'), offset: 1_000_000n });
  assert.equal(stale.body.length, 0, 'a replaced file must never continue an old stream');
  const allocated = (await actor.stable_storage_status()).allocated_bytes;
  ok(await actor.delete_blob(path));
  await upload(path, replacement);
  assert.equal((await actor.stable_storage_status()).allocated_bytes, allocated, 'deleted slots must be reused');
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.deepEqual(await download(path), replacement);
  assert.equal((await actor.stable_storage_status()).enabled, true);
  assert.equal((await actor.health()).total_bytes, BigInt(replacement.length));
  const response = await actor.http_request({ url: '/missing', method: 'GET', headers: [], body: [] });
  assert.equal(response.status_code, 404);
  // Real actor calls across two stores, including concurrent quota admission.
  const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: resolve(root, 'backend/club_domain/.mops/.build/club_domain.wasm'), sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  club.actor.setPrincipal(governor);
  ok(await club.actor.create_club('c1', 'Test club', 'test-club', [], []));
  const second = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] });
  for (const store of [fixture, second]) {
    store.actor.setPrincipal(governor);
    ok(await store.actor.set_club_domain_canister(club.canisterId));
    ok(await club.actor.register_media_quota_store(store.canisterId));
  }
  ok(await club.actor.start_media_quota_cutover());
  assert.ok('Err' in await club.actor.activate_media_quota());
  for (const store of [fixture, second]) {
    ok(await store.actor.freeze_media_quota());
    assert.ok('Err' in await store.actor.begin_upload('clubs/c1/new', 'image/jpeg', 1n, 1));
    ok(await club.actor.import_media_quota_store(store.canisterId));
  }
  ok(await club.actor.activate_media_quota());
  for (const store of [fixture, second]) { ok(await store.actor.enable_shared_media_quota()); store.actor.setPrincipal(owner); }
  club.actor.setPrincipal(other);
  assert.ok('Err' in await club.actor.reserve_media_quota('spoof', 'c1', 'gallery_photo', 1n, 0n));
  const reservations = await Promise.all(Array.from({ length: 8 }, (_, i) => {
    const store = i % 2 ? second.actor : actor;
    return store.begin_upload(`clubs/c1/photos/${i}.jpg`, 'image/jpeg', 1n, 1).then(result => ({ store, id: ok(result) }));
  }));
  for (const { store, id } of reservations) { ok(await store.put_chunk(id, 0, [42])); const finalized = ok(await store.finalize_upload(id)); assert.deepEqual(ok(await store.finalize_upload(id)), finalized); assert.ok('Err' in await store.abort_upload(id)); }
  const tail = await Promise.all([actor.begin_upload('clubs/c1/photos/8.jpg', 'image/jpeg', 1n, 1), second.actor.begin_upload('clubs/c1/photos/9.jpg', 'image/jpeg', 1n, 1)]);
  const ninth = ok(tail[0]); const tenth = ok(tail[1]);
  assert.ok('Err' in await actor.begin_upload('clubs/c1/photos/over.jpg', 'image/jpeg', 1n, 1));
  ok(await second.actor.abort_upload(tenth));
  const replacementId = ok(await second.actor.begin_upload('clubs/c1/photos/released.jpg', 'image/jpeg', 1n, 1));
  const sameId = ok(await second.actor.begin_upload('clubs/c1/photos/released.jpg', 'image/jpeg', 1n, 1));
  assert.equal(replacementId, sameId);
  for (const [store, id] of [[actor, ninth], [second.actor, replacementId]]) { ok(await store.put_chunk(id, 0, [42])); ok(await store.finalize_upload(id)); }
  assert.ok('Err' in await actor.begin_upload('clubs/c1/photos/still-over.jpg', 'image/jpeg', 1n, 1));
  // Advance across an exact 30-day quota boundary; fresh allowance must open.
  await pic.advanceTime(31 * 86_400_000); await pic.tick();
  const nextCycle = ok(await actor.begin_upload('clubs/c1/photos/next-cycle.jpg', 'image/jpeg', 1n, 1));
  ok(await actor.put_chunk(nextCycle, 0, [43])); ok(await actor.finalize_upload(nextCycle));
  await pic.advanceTime(181 * 86_400_000); await pic.tick(10);
  const expired = await actor.http_request({ url: '/clubs/c1/photos/0.jpg', method: 'GET', headers: [], body: [] });
  assert.equal(expired.status_code, 404, 'known-free club ciphertext must expire after six months');
  assert.deepEqual(await download(path), replacement, 'personal media without a club retention rule is retained');
  console.log('PASS: authenticated upload, streaming read-back, migration integrity/idempotency, owner denial, replacement/delete/reuse and EOP upgrade preservation.');
  console.log('PASS: real two-store freeze/import/activation, denied spoofed reservation, 10 shared slots including pending writes, idempotent begin/finalize, release/refund and 30-day boundary.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}