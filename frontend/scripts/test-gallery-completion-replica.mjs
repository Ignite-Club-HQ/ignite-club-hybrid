// Disposable canisters only; no production IDs, credentials or upgrades.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as mediaIdl } from '../src/lab/bindings/media_metadata/declarations/media_metadata.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as vaultIdl } from '../src/lab/bindings/vault_domain/declarations/vault_domain.did.js';
import { idlFactory as queueIdl } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
const root = resolve(import.meta.dirname, '../..');
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), member = p(2), outsider = p(3), staff = p(4);
const ok = r => { assert.ok('Ok' in r, r.Err); return r.Ok; };
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN }); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const setup = (name, idlFactory) => pic.setupCanister({ idlFactory, wasm: resolve(root, `backend/${name}/.mops/.build/${name}.wasm`), sender: governor,
    controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  const media = await setup('media_metadata', mediaIdl), club = await setup('club_domain', clubIdl);
  const store = await pic.setupCanister({ idlFactory: ({IDL}) => IDL.Service({get_content_hash: IDL.Func([IDL.Text], [IDL.Opt(IDL.Text)], ['query'])}),
    wasm: '/tmp/gallery-store.wasm', sender: governor, controllers: [governor] });
  const vault = await setup('vault_domain', vaultIdl), queue = await setup('notification_queue', queueIdl);
  for (const x of [media, club, vault, queue]) x.actor.setPrincipal(governor);
  ok(await club.actor.create_club('club-a', 'Local gallery', 'gallery-test', [], []));
  const acl = ok(await club.actor.export_acl());
  ok(await club.actor.replace_acl(acl.acl_version, { ...acl.acl, roles: [
    { user: governor, role: 'club_admin', club: ['club-a'], team: [] },
    { user: member, role: 'member', club: ['club-a'], team: [] },
    { user: staff, role: 'club_admin', club: ['club-a'], team: [] }] }));
  ok(await media.actor.grant_role(member, 'member', ['club-a'], []));
  ok(await media.actor.set_gallery_authorities(club.canisterId, vault.canisterId));
  ok(await club.actor.set_gallery_media_authority(media.canisterId));
  ok(await vault.actor.set_gallery_media_authority(media.canisterId));
  ok(await vault.actor.set_club_domain_canister(club.canisterId));
  ok(await club.actor.set_notification_queue_canister(queue.canisterId));
  ok(await queue.actor.set_club_domain_canister(club.canisterId));
  const asset = ok(await media.actor.register_asset('club-a', 'photo', 'image/jpeg', 'hash', 'clubs/club-a/gallery/photo', 'club', 99_999_999_999_999n));
  ok(await media.actor.set_blob_ref(asset.id, [{ canister: store.canisterId.toText(), path: 'clubs/club-a/gallery/photo', content_hash: 'hash' }]));
  ok(await media.actor.announce_gallery_asset(asset.id));
  ok(await media.actor.announce_gallery_asset(asset.id));
  queue.actor.setPrincipal(member);
  assert.equal(ok(await queue.actor.list_inbox(member.toText(), ['club-a'], 20)).filter(n => n.kind === 'photo_uploaded').length, 1);
  assert.ok('Err' in await queue.actor.fan_out([member.toText()], 'club-a', 'photo_comment', 'fake', 'fake', [asset.id]));
  media.actor.setPrincipal(member);
  assert.equal(ok(await media.actor.record_gallery_view(asset.id)), 1n);
  assert.deepEqual(ok(await media.actor.read_gallery_view_counts([asset.id])), [[asset.id, 1n]]);
  media.actor.setPrincipal(outsider);
  assert.deepEqual(ok(await media.actor.read_gallery_view_counts([asset.id])), []);
  assert.ok('Err' in await media.actor.record_gallery_view(asset.id));
  media.actor.setPrincipal(member);
  const comment = ok(await media.actor.add_comment_reply(asset.id, 'Nice photo', []));
  media.actor.setPrincipal(governor);
  const reply = ok(await media.actor.add_comment_reply(asset.id, 'Thanks', [comment.id]));
  assert.deepEqual(reply.reply_to_id, [comment.id]);
  assert.ok('Err' in await media.actor.add_comment_reply(asset.id, 'Wrong parent', ['foreign-comment']));
  media.actor.setPrincipal(outsider);
  assert.ok('Err' in await media.actor.add_comment_reply(asset.id, 'Denied', []));
  assert.ok('Err' in await media.actor.remove_gallery_asset(asset.id, 'feed_and_vault'));
  club.actor.setPrincipal(outsider);
  assert.ok('Err' in await club.actor.relay_gallery_notice(member, 'club-a', [], governor, [], 'photo_comment', 'spoof', asset.id));
  media.actor.setPrincipal(governor);
  // A Free club cannot register a private gallery copy, and identical gallery bytes are never reused.
  vault.actor.setPrincipal(governor);
  const copy = { canister: store.canisterId.toText(), path: 'clubs/club-a/vault/gallery-private', content_hash: 'private-hash' };
  assert.ok('Err' in await vault.actor.register_gallery_copy(asset.id, 'photo.jpg', 'https://private.example/photo', 5n, 'image/jpeg', copy));
  assert.ok('Err' in await vault.actor.register_gallery_copy(asset.id, 'photo.jpg', 'https://private.example/photo', 5n, 'image/jpeg', { ...copy, canister: vault.canisterId.toText() }));
  // Enable the existing authoritative club subscription, not a global personal entitlement.
  const sub = { club_id: 'club-a', is_pro: true, is_pro_football: false, admin_pro_override: true, admin_pro_football_override: false,
    expires_at_ms: [], is_trial: false, trial_ends_at_ms: [], plan: 'usd_v2_3_teams', team_limit: [3], updated_at_ms: 1n };
  const subFields = clubIdl({ IDL })._fields.find(([n]) => n === 'save_club_subscription')[1].argTypes[0]._fields;
  for (const [name, type] of subFields) if (!(name in sub)) {
    const t = type.display(); sub[name] = t.startsWith('opt') ? [] : t === 'bool' ? false : t === 'text' ? '' : 0n;
  }
  club.actor.setPrincipal(governor); ok(await club.actor.save_club_subscription(sub));
  assert.ok('Err' in await vault.actor.register_gallery_copy(asset.id, 'photo.jpg', 'https://private.example/photo', 5n, 'image/jpeg', { ...copy, content_hash: 'wrong' }));
  const registered = ok(await vault.actor.register_gallery_copy(asset.id, 'photo.jpg', 'https://private.example/photo', 5n, 'image/jpeg', copy));
  assert.equal(ok(await vault.actor.register_gallery_copy(asset.id, 'photo.jpg', 'https://private.example/photo', 5n, 'image/jpeg', copy)).id, registered.id);
  media.actor.setPrincipal(member);
  const own = ok(await media.actor.register_asset('club-a', 'photo', 'image/jpeg', 'owned', 'clubs/club-a/gallery/owned', 'club', 99_999_999_999_999n));
  ok(await media.actor.set_asset_scope(own.id, ['team-gallery'], [], [], [], [], ['album-owned']));
  const card = ok(await media.actor.save_gallery_chat_card([], 'club-a', 'team-gallery', [], 'gallery-receipt', [own.id], [], 1, [own.id], false, false));
  assert.equal(ok(await media.actor.save_gallery_chat_card([], 'club-a', 'team-gallery', [], 'gallery-receipt', [own.id], [], 1, [own.id], false, false)).id, card.id);
  assert.ok('Err' in await media.actor.save_gallery_chat_card([], 'club-a', 'foreign-team', [], 'gallery-foreign', [own.id], [], 1, [own.id], false, false));
  media.actor.setPrincipal(governor);
  ok(await media.actor.remove_gallery_asset(asset.id, 'feed_only'));
  assert.equal((await media.actor.list_assets('club-a')).filter(a => a.id === asset.id).length, 0);
  assert.deepEqual(await media.actor.get_asset(asset.id), []);
  assert.deepEqual(await media.actor.list_comments(asset.id), []);
  assert.equal(ok(await vault.actor.get_gallery_copy(asset.id))[0].deleted_at_ms.length, 0);
  media.actor.setPrincipal(staff);
  assert.equal(ok(await media.actor.remove_gallery_asset(asset.id, 'feed_and_vault')).vault_updated, true);
  vault.actor.setPrincipal(governor);
  assert.equal(ok(await vault.actor.get_file(registered.id))[0], undefined);
  media.actor.setPrincipal(governor);
  await pic.upgradeCanister({ canisterId: media.canisterId, wasm: resolve(root, 'backend/media_metadata/.mops/.build/media_metadata.wasm'), sender: governor,
    arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.equal((await media.actor.list_assets('club-a')).filter(a => a.id === asset.id).length, 0);
  console.log('PASS: replies/foreign denial, upload notice dedup/inbox, spoofed gallery notices refused, exact scoped Pro, private-copy dedup, feed-only retention, staff feed+Vault deletion and memory-preserving upgrade.');
} finally { await pic?.tearDown(); await server.stop(); }
