// Disposable replica only. Existing main.wasm is the recorded pre-index module.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/media_metadata/declarations/media_metadata.did.js';
const root = resolve(import.meta.dirname, '../..');
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const stranger = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const member = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const destination = Principal.fromUint8Array(Uint8Array.from([4, 1]));
const ok = reply => { assert.ok('Ok' in reply, JSON.stringify(reply)); return reply.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const fixture = await pic.setupCanister({ idlFactory, wasm: resolve(root, 'backend/media_metadata/main.wasm'),
    sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  const actor = fixture.actor; actor.setPrincipal(governor);
  const assetIds = [];
  for (let i = 0; i < 405; i++) {
    const asset = ok(await actor.register_asset('club', 'photo', 'image/jpeg', 'hash', `clubs/club/${i}`, 'club', 99_999_999_999_999n));
    assetIds.push(asset.id);
  }
  const upgrade = () => pic.upgradeCanister({ canisterId: fixture.canisterId, sender: governor,
    wasm: resolve(root, 'backend/media_metadata/.mops/.build/media_metadata.wasm'), arg: IDL.encode([IDL.Principal], [governor]),
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  await upgrade();
  assert.deepEqual(await actor.list_assets_page('club', [], 60n), { Err: 'Media page index not ready' });
  assert.deepEqual(ok(await actor.build_asset_page_index()), { scanned: 200n, complete: false });
  await upgrade(); // Pending index and progress must survive an upgrade.
  const concurrent = ok(await actor.register_asset('club', 'photo', 'image/jpeg', 'hash', 'clubs/club/concurrent', 'club', 99_999_999_999_999n));
  assetIds.push(concurrent.id);
  assert.deepEqual(ok(await actor.build_asset_page_index()), { scanned: 200n, complete: false });
  assert.deepEqual(ok(await actor.build_asset_page_index()), { scanned: 6n, complete: true });
  assert.deepEqual(ok(await actor.build_asset_page_index()), { scanned: 0n, complete: true });
  const drain = async who => {
    actor.setPrincipal(who); let cursor = []; const found = [];
    for (let i = 0; i < 20; i++) {
      const page = ok(await actor.list_assets_page('club', cursor, 60n));
      assert.ok(page.scanned <= 200n); assert.ok(page.assets.length <= 60);
      found.push(...page.assets); cursor = page.next;
      if (!cursor.length) return found;
    }
    throw Error('Paging failed to exhaust');
  };
  const all = await drain(governor);
  assert.equal(all.length, 406); assert.equal(new Set(all.map(a => a.id)).size, 406);
  assert.deepEqual(new Set(all.map(a => a.id)), new Set(assetIds));
  const ordering = a => `${String(a.created_at_ms).padStart(20, '0')}:${a.id}`;
  assert.deepEqual(all.map(ordering), all.map(ordering).sort().reverse());
  actor.setPrincipal(stranger);
  const hidden = ok(await actor.list_assets_page('club', [], 60n));
  assert.equal(hidden.assets.length, 0); assert.equal(hidden.scanned, 200n); assert.equal(hidden.next.length, 1);
  assert.equal((await drain(stranger)).length, 0);
  assert.ok('Err' in await actor.list_assets_page('other', hidden.next, 60n));
  assert.ok('Err' in await actor.build_asset_page_index());
  actor.setPrincipal(Principal.anonymous()); assert.ok('Err' in await actor.list_assets_page('club', [], 60n));
  actor.setPrincipal(governor);
  assert.ok('Err' in await actor.list_assets_page('club', [], 0n));
  assert.ok('Err' in await actor.list_assets_page('club', [], 61n));
  ok(await actor.grant_role(stranger, 'member', ['club'], []));
  actor.setPrincipal(stranger); assert.ok('Err' in await actor.list_assets_page('club', hidden.next, 60n));
  assert.equal((await drain(stranger)).length, 406);
  actor.setPrincipal(governor);
  const beforeDelete = ok(await actor.list_assets_page('club', [], 60n));
  ok(await actor.delete_asset(all[0].id));
  assert.ok('Err' in await actor.list_assets_page('club', beforeDelete.next, 60n));
  assert.equal((await drain(governor)).length, 405);
  const beforeRekey = ok(await actor.list_assets_page('club', [], 60n));
  ok(await actor.grant_role(member, 'member', ['club'], []));
  assert.ok('ok' in await actor.rekey_principal(member, destination, false));
  assert.ok('Err' in await actor.list_assets_page('club', beforeRekey.next, 60n));
  assert.equal((await drain(destination)).length, 405);
  actor.setPrincipal(governor);
  ok(await actor.set_transfer_fence('club', true));
  const snapshot = ok(await actor.export_club_snapshot('club'));
  ok(await actor.import_club_snapshot('club', snapshot));
  assert.deepEqual(await actor.list_assets_page('club', [], 60n), { Err: 'Media page index not ready' });
  for (let i = 0; i < 3; i++) ok(await actor.build_asset_page_index());
  assert.equal((await drain(governor)).length, 405);
  actor.setPrincipal(governor); ok(await actor.purge_club_snapshot('club'));
  assert.equal(ok(await actor.list_assets_page('club', [], 60n)).assets.length, 0);
  console.log('PASS: populated pre-index upgrade, bounded resumable backfill, overlapping registration, ordering/visibility, empty continuation, role/delete/rekey invalidation, snapshot locator rebuild and purge. Disposable replica only.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }