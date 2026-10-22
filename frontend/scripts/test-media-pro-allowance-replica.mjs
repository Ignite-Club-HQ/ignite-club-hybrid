// Isolated PocketIC integration: the combined Pro media allowance (vault +
// gallery + chat) is enforced by the photo store itself, and the club-bytes
// query reports the same finalized + pending figures. The exact 3 GiB
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
const FILE = 10_485_896n; // per-file cap: 10 MiB plaintext + encryption framing
const framing = 136n;
const framedBytes = size => { const bytes = new Uint8Array(size); bytes.set([73, 67, 32, 73, 66, 69, 0, 1]); return bytes; };
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
  assert.equal(bytes.pending, 2n * (FILE - framing));
  assert.equal(bytes.finalized, 0n);

  // A chat reservation joins the same pot and aborts release their slice.
  const chatReservation = ok(await reserve('clubs/club-pro/chat/messages/2.jpg', 1_000n));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.pending, 2n * (FILE - framing) + 864n);
  ok(await actor.abort_upload(chatReservation));
  ok(await actor.abort_upload(vault));
  ok(await actor.abort_upload(gallery));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.pending, 0n);

  // Finalized bytes are reported through the same query.
  const chat = ok(await actor.begin_upload('clubs/club-pro/chat/messages/2.jpg', 'image/jpeg', 1_000n, 1));
  ok(await actor.put_chunk(chat, 0, framedBytes(1_000)));
  ok(await actor.finalize_upload(chat));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.finalized, 864n);
  assert.equal(bytes.pending, 0n);
  const pendingAgain = ok(await reserve('clubs/club-pro/photos/rest.jpg', FILE));
  bytes = await actor.get_club_media_bytes('club-pro');
  assert.equal(bytes.finalized, 864n);
  assert.equal(bytes.pending, FILE - framing);
  ok(await actor.abort_upload(pendingAgain));
  const branding = ok(await reserve('clubs/club-pro/logos/logo.png', 50n));
  assert.equal((await actor.get_club_media_bytes('club-pro')).pending, 0n);
  ok(await actor.abort_upload(branding));
  const invalid = ok(await reserve('clubs/club-pro/photos/raw.jpg', 1_000n));
  ok(await actor.put_chunk(invalid, 0, new Uint8Array(1_000)));
  ok(await actor.finalize_upload(invalid));
  assert.equal((await actor.get_club_media_bytes('club-pro')).finalized, 1_864n, 'Unframed legacy bytes do not earn a framing discount');
  ok(await actor.delete_blob('clubs/club-pro/photos/raw.jpg'));

  // Free clubs have a smaller combined allowance and their monthly caps.
  ok(await clubActor.create_club('club-free', 'Free Club', 'club-free', [], []));
  ok(await clubActor.add_role_grant(owner, 'club-free', 'player', []));
  ok(await clubActor.save_club_subscription({
    activated_at_ms: [], admin_pro_football_override: false, admin_pro_override: false, cancelled_at_ms: [],
    club_id: 'club-free', expires_at_ms: [], is_pro: false, is_pro_football: false, is_trial: false,
    plan: 'free', team_limit: [], trial_ends_at_ms: [],
  }));
  ok(await actor.begin_upload('clubs/club-free/photos/small.jpg', 'image/jpeg', 1_000n, 1));

  // The authoritative query distinguishes legacy grants from new tiers and
  // refuses a team ID from another club; no frontend status is trusted.
  assert.equal(ok(await clubActor.get_media_allowance('club-free', [])).limit_bytes, 262_144_000n);
  assert.equal(ok(await clubActor.get_media_allowance('club-pro', [])).limit_bytes, 3_221_225_472n);
  const team = {
    id: 'team-one', club_id: 'club-free', name: 'Team One', archived: false,
    is_active: true, is_shell: false, playhq_auto_create_events: false,
    age_group: [], deleted_at_ms: [], description: [], division: [], folder_id: [], gender: [], logo_url: [],
    playhq_competition_id: [], playhq_team_id: [], shell_claim_token: [], shell_claimed_at_ms: [],
    shell_claimed_by: [], shell_contact_email: [], shell_contact_name: [], shell_invited_by: [], team_type: [],
  };
  ok(await clubActor.save_team(team));
  ok(await clubActor.save_team_subscription({
    team_id: team.id, is_pro: true, is_pro_football: false, admin_pro_override: false, admin_pro_football_override: false,
    cancelled_at_ms: [], disable_auto_subs: false, disable_batch_subs: false, disable_position_swaps: false,
    disable_team_pom_rewards: false, formation: [], is_trial: false, max_spread_minutes: [], minutes_per_half: [],
    rotate_gk_at_halftime: false, rotation_speed: 1, show_lineup_picker: false, team_size: [], trial_ends_at_ms: [],
  }));
  assert.deepEqual(ok(await clubActor.get_media_allowance('club-free', [team.id])), {
    base_bytes: 1_073_741_824n, limit_bytes: 1_073_741_824n, team_scoped: true, premium: true,
  });
  assert.match((await clubActor.get_media_allowance('club-pro', [team.id])).Err, /does not belong/);
  const teamUpload = ok(await reserve('clubs/club-free/teams/team-one/photos/pending.jpg', 1_000n));
  const retainedPending = await actor.get_club_media_bytes('club-free');
  await pic.upgradeCanister({ canisterId: store.canisterId, wasm, sender: governor,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.deepEqual(await actor.get_club_media_bytes('club-free'), retainedPending);
  ok(await actor.put_chunk(teamUpload, 0, framedBytes(1_000)));
  ok(await actor.finalize_upload(teamUpload));
  assert.equal((await actor.get_club_media_bytes('club-free')).finalized, 864n);
  const subscription = {
    activated_at_ms: [], admin_pro_football_override: false, admin_pro_override: false, cancelled_at_ms: [],
    club_id: 'club-pro', expires_at_ms: [], is_pro: true, is_pro_football: false, is_trial: false,
    plan: 'unlimited', team_limit: [], trial_ends_at_ms: [],
  };
  ok(await clubActor.save_club_subscription(subscription));
  assert.equal(ok(await clubActor.get_media_allowance('club-pro', [])).limit_bytes, 5_368_709_120n);
  clubActor.setPrincipal(owner);
  assert.match((await clubActor.save_club_subscription({ ...subscription, plan: 'usd_v2_standard', team_limit: [21] })).Err, /Platform admin required/);
  clubActor.setPrincipal(governor);
  ok(await clubActor.save_club_subscription({ ...subscription, plan: 'usd_v2_standard', team_limit: [20] }));
  assert.equal(ok(await clubActor.get_media_allowance('club-pro', [])).limit_bytes, 3_221_225_472n);
  ok(await clubActor.save_club_subscription({ ...subscription, expires_at_ms: [1n] }));
  assert.equal(ok(await clubActor.get_media_allowance('club-pro', [])).limit_bytes, 262_144_000n);
  assert.equal((await actor.get_club_media_bytes('club-pro')).finalized, 864n, 'Expiry does not delete existing files');
  // Exercise the real timer for both club-only Free media and media under a
  // Free club whose individual team remains Pro.
  const freePath = 'clubs/club-free/photos/expired.jpg';
  const freeUpload = ok(await reserve(freePath, 1_000n));
  ok(await actor.put_chunk(freeUpload, 0, framedBytes(1_000)));
  ok(await actor.finalize_upload(freeUpload));
  await pic.advanceTime(181 * 86_400_000);
  await pic.tick(100);
  const readStatus = async path => (await actor.http_request({ url: `/${path}`, method: 'GET', headers: [], body: [] })).status_code;
  assert.equal(await readStatus(freePath), 404, 'Expired Free club media is removed');
  assert.equal(await readStatus('clubs/club-free/teams/team-one/photos/pending.jpg'), 200, 'Active Single Team media is retained');

  console.log('PASS: plaintext accounting excludes 136-byte SDK framing, unframed bytes charged in full, combined pending media, branding exemption, team scope, wrong-club refusal, denied self-granted seats, versioned 3 GiB and legacy 5 GiB allowances, expiry preserves files, upgrade/readback and Free/Pro retention.');
} finally {
  await server.stop();
}
