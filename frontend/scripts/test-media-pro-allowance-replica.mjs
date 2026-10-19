// Isolated PocketIC integration: the combined Pro media allowance (vault +
// gallery + chat) is enforced by the photo store itself, and the club-bytes
// query reports the same finalized + pending figures. The exact 5 GiB
// boundary arithmetic is unit-tested in uploadPolicy.test.mo; a full fill is
// not possible on a replica (pending reservations are heap-budgeted), so the
// replica proves the wiring at small scale. Never mainnet.
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
const FILE = 10_551_296n; // per-file cap: 10 MiB plaintext + encryption framing
const ok = result => { assert.ok('Ok' in result, JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v)); return result.Ok; };
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/tmp/pocket-ic' });
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: clubWasm, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  const store = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] });
  const clubActor = club.actor;
  const actor = store.actor;
  clubActor.setPrincipal(governor);
  actor.setPrincipal(governor);
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
    const chunks = Math.max(1, Math.ceil(Number(size) / 1_000_000));
    return actor.begin_upload(path, 'image/jpeg', size, chunks);
  }

  // Pro club: gallery and vault reservations stack in the same combined pot.
  const galleryRaw = await reserve('clubs/club-pro/photos/a.jpg', FILE);
  const gallery = ok(galleryRaw);
  const vault = ok(await reserve('clubs/club-pro/vault/file.bin', FILE));
  let bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.pending, 2n * FILE);
  assert.equal(bytes.finalized, 0n);

  // A chat reservation joins the same pot and aborts release their slice.
  const chatReservation = ok(await reserve('clubs/club-pro/chat/messages/2.jpg', 1_000n));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.pending, 2n * FILE + 1_000n);
  ok(await actor.abort_upload(chatReservation));
  ok(await actor.abort_upload(vault));
  ok(await actor.abort_upload(gallery));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.pending, 0n);

  // Finalized bytes are reported through the same query.
  const chat = ok(await actor.begin_upload('clubs/club-pro/chat/messages/2.jpg', 'image/jpeg', 1_000n, 1));
  ok(await actor.put_chunk(chat, 0, new Uint8Array(1_000)));
  ok(await actor.finalize_upload(chat));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.finalized, 1_000n);
  assert.equal(bytes.pending, 0n);
  const pendingAgain = ok(await reserve('clubs/club-pro/photos/rest.jpg', FILE));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.finalized, 1_000n);
  assert.equal(bytes.pending, FILE);
  ok(await actor.abort_upload(pendingAgain));
  const branding = ok(await reserve('clubs/club-pro/logos/logo.png', 50n));
  assert.equal((await actor.get_club_media_bytes('club-pro')).pending, 50n);
  ok(await actor.abort_upload(branding));

  // Free clubs are not subject to the Pro allowance, only their cycle caps.
  ok(await clubActor.create_club('club-free', 'Free Club', 'club-free', [], []));
  ok(await clubActor.add_role_grant(owner, 'club-free', 'player', []));
  ok(await clubActor.save_club_subscription({
    activated_at_ms: [], admin_pro_football_override: false, admin_pro_override: false, cancelled_at_ms: [],
    club_id: 'club-free', expires_at_ms: [], is_pro: false, is_pro_football: false, is_trial: false,
    plan: 'free', team_limit: [], trial_ends_at_ms: [],
  }));
  ok(await actor.begin_upload('clubs/club-free/photos/small.jpg', 'image/jpeg', 1_000n, 1));

  console.log('PASS: the photo store counts gallery, vault and chat bytes into one combined Pro pot, and get_club_media_bytes reports the exact finalized + pending figures the admission check uses.');
} finally {
  await server.stop();
}
