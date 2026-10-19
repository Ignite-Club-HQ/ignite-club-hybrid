// Isolated PocketIC contract rehearsal, never mainnet. Requires local media WASM.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wasm = resolve(root, 'backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const owner = Principal.fromUint8Array(new Uint8Array([2, 1]));
const ok = r => { assert.ok('Ok' in r); return r.Ok; };
const start = { phase: { legacy: null }, offset: 0n, after: '' };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const fixture = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] });
  const a = fixture.actor;
  a.setPrincipal(owner);
  const oldPath = 'clubs/c/chat/orphan';
  const id = ok(await a.begin_upload(oldPath, 'image/jpeg', 1n, 1));
  ok(await a.put_chunk(id, 0, [42])); ok(await a.finalize_upload(id));
  const pending = ok(await a.begin_upload('clubs/c/vault/pending', 'text/plain', 1n, 1));
  assert.ok('Err' in await a.club_media_inventory_page('c', start, []));
  assert.ok('Err' in await a.set_club_media_transfer_fence('c', true, []));
  a.setPrincipal(governor);
  ok(await a.set_club_media_transfer_fence('c', true, []));
  const first = ok(await a.club_media_inventory_page('c', start, []));
  assert.equal(first.fenced, true); assert.equal(first.quota_shared, false);
  assert.equal(first.entries[0].path, oldPath); assert.equal(first.entries[0].kind.blob, null);
  const pendingPage = ok(await a.club_media_inventory_page('c', { phase: { pending: null }, offset: 0n, after: '' }, [first.revision]));
  assert.equal(pendingPage.entries[0].upload_id, pending);
  a.setPrincipal(owner);
  assert.ok('Err' in await a.begin_upload('clubs/c/photos/blocked', 'image/jpeg', 1n, 1));
  assert.ok('Err' in await a.delete_blob(oldPath));
  ok(await a.abort_upload(pending)); // existing work can drain under the fence
  a.setPrincipal(governor);
  assert.ok('Err' in await a.club_media_inventory_page('c', start, [first.revision]));
  const drained = ok(await a.club_media_inventory_page('c', { phase: { pending: null }, offset: 0n, after: '' }, []));
  assert.equal(drained.entries.length, 0);
  const fence = drained.fence_revision;
  assert.ok('Err' in await a.set_club_media_transfer_fence('c', false, [999999n]));
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  const upgraded = ok(await a.club_media_inventory_page('c', start, [drained.revision]));
  assert.deepEqual(upgraded.fence_revision, fence); assert.equal(upgraded.entries[0].path, oldPath);
  assert.ok('Err' in await a.migrate_legacy_blob());
  ok(await a.set_club_media_transfer_fence('c', false, fence));
  ok(await a.migrate_legacy_blob()); ok(await a.enable_stable_media_storage());
  // Scan >200 stored ciphertext records without a giant response. Governor
  // fixtures bypass free local quota; admission rules themselves are unchanged.
  for (let i = 0; i < 202; i++) {
    const token = ok(await a.begin_upload(`clubs/c/photos/${String(i).padStart(3, '0')}`, 'image/jpeg', 1n, 1));
    ok(await a.put_chunk(token, 0, [i % 255])); ok(await a.finalize_upload(token));
  }
  ok(await a.set_club_media_transfer_fence('c', true, []));
  let cursor = start; let revision; const entries = []; let pages = 0;
  do {
    const page = ok(await a.club_media_inventory_page('c', cursor, revision === undefined ? [] : [revision]));
    assert.ok(page.scanned <= 200n); revision = page.revision; entries.push(...page.entries);
    cursor = page.next[0]; assert.ok(++pages < 10);
  } while (cursor);
  assert.equal(entries.filter(e => 'blob' in e.kind).length, 203);
  assert.equal(new Set(entries.map(e => e.path)).size, 203);
  console.log('PASS: governor-only bounded legacy/stable/orphan/pending inventory, revision invalidation, persisted CAS fences, drain/upgrade preservation, and 203-record paging.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }