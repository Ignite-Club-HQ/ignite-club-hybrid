// Bounded consensus inventories against real local actors. Never mainnet.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as gallery } from '../src/lab/bindings/media_metadata/declarations/media_metadata.did.js';
import { idlFactory as chat } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as vault } from '../src/lab/bindings/vault_domain/declarations/vault_domain.did.js';
import { idlFactory as articles } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const root = resolve(import.meta.dirname, '../..'); const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const stranger = Principal.fromUint8Array(new Uint8Array([2, 1]));
const ok = r => { assert.ok('Ok' in r); return r.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl()); const fixtures = {};
  for (const [name, idlFactory] of Object.entries({ media_metadata: gallery, messaging_domain: chat, vault_domain: vault, club_domain: articles })) {
    const f = await pic.setupCanister({ idlFactory, wasm: resolve(root, `backend/${name}/.mops/.build/${name}.wasm`), sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
    f.actor.setPrincipal(governor); fixtures[name] = f;
  }
  const a = fixtures.media_metadata.actor;
  for (let i = 0; i < 201; i++) ok(await a.register_asset(i === 200 ? 'c' : 'other', 'photo', 'image/jpeg', 'hash', `clubs/${i === 200 ? 'c' : 'other'}/${i}`, 'club', 99_999_999_999_999n));
  const c = fixtures.messaging_domain.actor; const conv = ok(await c.create_conversation('c', [], [governor]));
  ok(await c.send_message(conv.id, 'Photo', 'media', [{ kind: 'image', ref_id: 'photo', url: ['https://store.raw.icp0.io/clubs/c/chat/photo'] }], []));
  const v = fixtures.vault_domain.actor; ok(await v.grant_role(governor, 'club_admin', ['c'], []));
  ok(await v.create_folder('f', 'c', [], [], 'Files', [], [], [], 0, [], []));
  ok(await v.register_file('p', 'f', 'c', [], 'private.pdf', 'https://store.raw.icp0.io/clubs/c/vault/p', 1n, 'application/pdf', false, [], [], []));
  const news = fixtures.club_domain.actor; ok(await news.create_club('c', 'Club', 'c', [], []));
  ok(await news.create_news_post('c', 'News', '', 'draft', [], [], [], false, false, ['https://store.raw.icp0.io/clubs/c/news/p'], []));
  for (const [name, f] of Object.entries(fixtures)) {
    assert.ok('Err' in await f.actor.read_club_media_references('c', 0n, []));
    if (name === 'club_domain') ok(await f.actor.freeze_club('c', 1n)); else ok(await f.actor.set_transfer_fence('c', true));
    const first = ok(await f.actor.read_club_media_references('c', 0n, []));
    assert.ok(first.scanned <= 200n); assert.ok('Err' in await f.actor.read_club_media_references('c', 0n, [first.revision + 1n]));
    f.actor.setPrincipal(stranger); assert.ok('Err' in await f.actor.read_club_media_references('c', 0n, []).catch(e => ({ Err: String(e) }))); f.actor.setPrincipal(governor);
    if (name === 'media_metadata') {
      assert.equal(first.references.length, 0); assert.deepEqual(first.next, [200n]);
      assert.equal(ok(await f.actor.read_club_media_references('c', 200n, [first.revision])).references.length, 1);
    } else assert.equal(first.references.length, 1, `${name} reference included`);
    await pic.upgradeCanister({ canisterId: f.canisterId, wasm: resolve(root, `backend/${name}/.mops/.build/${name}.wasm`), sender: governor,
      arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    assert.deepEqual(ok(await f.actor.read_club_media_references('c', 0n, [first.revision])), first);
  }
  console.log('PASS: four real domain inventories, empty nonterminal page, 200-row bound, stranger/stale/fence denial and EOP preservation. Not production provenance.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }