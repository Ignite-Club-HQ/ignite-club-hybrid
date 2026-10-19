// Isolated PocketIC contract rehearsal, never mainnet. Requires local media WASM.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { readFencedClubStoreInventory } from '../src/live/mediaStoreInventory.ts';
import { mediaTransferPreparation } from '../src/live/mediaTransferPreparation.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wasm = resolve(root, 'backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const owner = Principal.fromUint8Array(new Uint8Array([2, 1]));
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const start = { phase: { legacy: null }, offset: 0n, after: '' };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const fixture = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] });
  const a = fixture.actor;
  // Club-path uploads require a live membership authority; wire the club up first.
  const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: resolve(root, 'backend/club_domain/.mops/.build/club_domain.wasm'), sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  club.actor.setPrincipal(governor); ok(await club.actor.create_club('c', 'Test club', 'test-club', [], []));
  ok(await club.actor.add_role_grant(owner, 'c', 'player', []));
  a.setPrincipal(governor); ok(await a.set_club_domain_canister(club.canisterId)); a.setPrincipal(owner);
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
  assert.ok('Err' in await a.club_media_inventory_page('c', { ...start, offset: 999n }, []));
  assert.ok('Err' in await a.club_media_inventory_page('c', { phase: { done: null }, offset: 1n, after: '' }, []));
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
  // Actual two-store consensus reader and uncertain quota journal coverage.
  // Registry is the complete isolated fixture, not production inventory proof.
  const second = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] });
  // Wiring is immutable while fenced. Release only this fixture's fence before
  // shared-quota setup, then take fresh fences on both registered stores.
  const existingFence = ok(await a.club_media_inventory_page('c', start, [])).fence_revision;
  ok(await a.set_club_media_transfer_fence('c', false, existingFence));
  for (const store of [fixture, second]) {
    store.actor.setPrincipal(governor);
    ok(await store.actor.set_club_domain_canister(club.canisterId));
    ok(await club.actor.register_media_quota_store(store.canisterId));
  }
  ok(await club.actor.start_media_quota_cutover());
  for (const store of [fixture, second]) {
    ok(await store.actor.freeze_media_quota()); ok(await club.actor.import_media_quota_store(store.canisterId));
  }
  ok(await club.actor.activate_media_quota());
  for (const store of [fixture, second]) ok(await store.actor.enable_shared_media_quota());
  await pic.advanceTime(31 * 86_400_000); await pic.tick();
  second.actor.setPrincipal(owner);
  const uncertain = ok(await second.actor.begin_upload('clubs/c/chat/uncertain', 'image/jpeg', 1n, 1));
  ok(await second.actor.put_chunk(uncertain, 0, [72]));
  await pic.stopCanister({ canisterId: club.canisterId, sender: governor });
  assert.ok('Err' in await second.actor.finalize_upload(uncertain));
  for (const store of [fixture, second]) {
    store.actor.setPrincipal(governor); ok(await store.actor.set_club_media_transfer_fence('c', true, []));
  }
  const registry = { deploymentId: 'isolated-pocketic', revision: '1', complete: true,
    stores: [fixture, second].map(s => ({ canisterId: s.canisterId.toText(), quotaAuthority: club.canisterId.toText(), actor: s.actor })) };
  const inventory = await readFencedClubStoreInventory('c', 'isolated-pocketic', async () => registry);
  assert.equal(inventory.encryptedObjects, 204);
  assert.equal(inventory.pendingUploads, 1, 'published ciphertext with uncertain commit remains unsettled');
  assert.equal(inventory.stores.length, 2);
  await pic.startCanister({ canisterId: club.canisterId, sender: governor });
  ok(await second.actor.reconcile_upload_operations(''));
  const settled = await readFencedClubStoreInventory('c', 'isolated-pocketic', async () => registry);
  assert.equal(settled.pendingUploads, 0); assert.equal(settled.encryptedObjects, 204);
  // Production preparation module, local authenticated complete fixture only.
  // Durable receipts survive a recreated operator and a real store upgrade.
  let receipt = null;
  const preparationDeps = { readRegistry: async () => registry,
    actor: id => registry.stores.find(s => s.canisterId === id).actor,
    load: async () => receipt, save: async value => { receipt = structuredClone(value); } };
  const binding = { moveId: 'local-media-preparation', deploymentId: registry.deploymentId,
    clubId: 'empty-club', fromGroup: 'a', toGroup: 'b' };
  const prepared = await mediaTransferPreparation(binding, preparationDeps).prepare();
  assert.equal(prepared.encryptedObjects, 0); assert.equal(prepared.stores.length, 2);
  assert.deepEqual(receipt.stores.map(s => s.state), ['held', 'held']);
  await pic.upgradeCanister({ canisterId: second.canisterId, wasm, sender: governor,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  const resumed = mediaTransferPreparation(binding, preparationDeps);
  const afterUpgrade = await resumed.prepare();
  assert.deepEqual(afterUpgrade.stores.map(s => s.fenceRevision), prepared.stores.map(s => s.fenceRevision));
  await resumed.release(); assert.deepEqual(receipt.stores.map(s => s.state), ['released', 'released']);
  // Releasing this club never releases the populated bystander's fences.
  const bystander = await readFencedClubStoreInventory('c', 'isolated-pocketic', async () => registry);
  assert.equal(bystander.encryptedObjects, 204);
  console.log('PASS: durable two-store operator preparation, restart and EOP upgrade resume, CAS release and bystander-fence isolation.');
  console.log('PASS: governor-only bounded legacy/stable/orphan/pending inventory, revision invalidation, persisted CAS fences, drain/upgrade preservation, and 203-record paging.');
  console.log('PASS: actual two-store consensus reader counts orphan objects, rejects malformed cursors, includes uncertain committed ciphertext and verifies settled recovery without dropping bytes.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }