// Isolated PocketIC integration: the combined Pro media allowance (vault +
// gallery + chat) is enforced by the photo store itself, and the club-bytes
// query reports the same finalized + pending figures. Never mainnet.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wasm = resolve(root, 'backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const clubWasm = resolve(root, 'backend/club_domain/.mops/.build/club_domain.wasm');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const owner = Principal.fromUint8Array(new Uint8Array([2, 1]));
const GiB = 1_073_741_824n;
const ALLOWANCE = 5n * GiB; // 5 GiB per Pro club, vault + gallery + chat combined
const ok = result => { assert.ok('Ok' in result, JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v)); return result.Ok; };
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: clubWasm, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  const store = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] });
  const clubActor = club.actor;
  const actor = store.actor;
  clubActor.setPrincipal(governor);
  ok(await clubActor.create_club('club-pro', 'Pro Club', 'club-pro', [], []));
  ok(await clubActor.add_role_grant(owner, 'club-pro', 'player', []));
  ok(await clubActor.save_club_subscription({
    activated_at_ms: [], admin_pro_football_override: false, admin_pro_override: false, cancelled_at_ms: [],
    club_id: 'club-pro', expires_at_ms: [], is_pro: true, is_pro_football: false, is_trial: false,
    plan: 'pro', team_limit: [], trial_ends_at_ms: [],
  }));
  ok(await actor.set_club_domain_canister(club.canisterId));
  actor.setPrincipal(owner);

  async function reserve(path, size) {
    return actor.begin_upload(path, 'image/jpeg', size, 1);
  }

  // The full allowance fits in a single gallery reservation (pending only; no bytes transferred).
  const giant = ok(await reserve('clubs/club-pro/photos/giant.jpg', ALLOWANCE - 1n));
  let bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.pending, ALLOWANCE - 1n);
  assert.equal(bytes.finalized, 0n);

  // Vault is refused while the gallery reservation holds the whole allowance.
  const vaultBlocked = await reserve('clubs/club-pro/vault/file.bin', 1n);
  assert.equal(vaultBlocked.Err, 'StorageAllowanceFull');

  // Chat is refused for the same reason: one combined allowance, not per category.
  const chatBlocked = await reserve('clubs/club-pro/chat/messages/2.jpg', 1n);
  assert.equal(chatBlocked.Err, 'StorageAllowanceFull');

  // Aborting the reservation releases it; a finalized chat photo then counts.
  ok(await actor.abort_upload(giant));
  const chat = ok(await actor.begin_upload('clubs/club-pro/chat/messages/2.jpg', 'image/jpeg', 1_000n, 1));
  ok(await actor.put_chunk(chat, 0, new Uint8Array(1_000)));
  ok(await actor.finalize_upload(chat));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.finalized, 1_000n);
  assert.equal(bytes.pending, 0n);

  // The remaining headroom spans every category: 2 GiB of vault fits after 1 KB of chat.
  const vault = ok(await actor.begin_upload('clubs/club-pro/vault/file.bin', 'application/octet-stream', 2n * GiB, 1));
  assert.equal((await actor.get_club_media_bytes('club-pro')).pending, 2n * GiB);
  // ...and pushing past 5 GiB combined is refused even across categories.
  const over = await reserve('clubs/club-pro/photos/over.jpg', 3n * GiB);
  assert.equal(over.Err, 'StorageAllowanceFull');
  ok(await actor.abort_upload(vault));

  // Finalized bytes also count: with 1 KB finalized, only 5 GiB - 1 KB of pending fits.
  const fits = ok(await reserve('clubs/club-pro/photos/rest.jpg', ALLOWANCE - 1_000n));
  const overFinalized = await reserve('clubs/club-pro/photos/over2.jpg', 1n);
  assert.equal(overFinalized.Err, 'StorageAllowanceFull');
  ok(await actor.abort_upload(fits));

  // Free clubs are not subject to the Pro allowance, only their cycle caps.
  ok(await clubActor.create_club('club-free', 'Free Club', 'club-free', [], []));
  ok(await clubActor.add_role_grant(owner, 'club-free', 'player', []));
  ok(await clubActor.save_club_subscription({
    activated_at_ms: [], admin_pro_football_override: false, admin_pro_override: false, cancelled_at_ms: [],
    club_id: 'club-free', expires_at_ms: [], is_pro: false, is_pro_football: false, is_trial: false,
    plan: 'free', team_limit: [], trial_ends_at_ms: [],
  }));
  ok(await actor.begin_upload('clubs/club-free/photos/small.jpg', 'image/jpeg', 1_000n, 1));

  console.log('PASS: the photo store enforces one combined Pro media allowance across vault, gallery and chat, and get_club_media_bytes reports the exact figures the admission check uses.');
} finally {
  await server.stop();
}
