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
import { checkpointMedia, restoreMedia, resumeMedia } from '../../scripts/media-recovery-coordinator.mjs';
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
  // Wiring rehearsal only: this does not allocate/fill 32 GiB or prove load.
  const large = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [
    { name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }, { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' },
  ] });
  large.actor.setPrincipal(governor);
  assert.ok('Err' in await large.actor.set_capacity_limit(34_359_738_368n));
  ok(await large.actor.enable_stable_media_storage());
  ok(await large.actor.set_capacity_limit(34_359_738_368n));
  assert.equal((await large.actor.get_usage()).capacity_limit_bytes, 34_359_738_368n);
  assert.ok('Err' in await large.actor.set_capacity_limit(214_748_364_801n));
  large.actor.setPrincipal(other);
  assert.ok('Err' in await large.actor.set_capacity_limit(2_147_483_648n));
  large.actor.setPrincipal(governor);
  await pic.upgradeCanister({ canisterId: large.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.equal((await large.actor.get_usage()).capacity_limit_bytes, 34_359_738_368n);
  assert.equal((await large.actor.stable_storage_status()).enabled, true);
  console.log('PASS: bounded governor-only 32 GiB setting needs stable writes and survives upgrade; not a full-volume load test.');
  const response = await actor.http_request({ url: '/missing', method: 'GET', headers: [], body: [] });
  assert.equal(response.status_code, 404);
  // Management-canister snapshot rollback must restore Region bytes, allocator,
  // metadata and flags together. Exercise real management calls, not mocks.
  const snapshotType = IDL.Record({ id: IDL.Vec(IDL.Nat8), taken_at_timestamp: IDL.Nat64, total_size: IDL.Nat64 });
  async function management(method, inputType, input, outputTypes = [], sender = governor) {
    const result = await pic.updateCall({ canisterId: Principal.managementCanister(), method, arg: IDL.encode([inputType], [input]), sender });
    return IDL.decode(outputTypes, result);
  }
  await pic.stopCanister({ canisterId: fixture.canisterId, sender: governor });
  const snapshotInput = IDL.Record({ canister_id: IDL.Principal, replace_snapshot: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  await assert.rejects(management('take_canister_snapshot', snapshotInput, { canister_id: fixture.canisterId, replace_snapshot: [] }, [snapshotType], other));
  const [snapshot] = await management('take_canister_snapshot', snapshotInput, { canister_id: fixture.canisterId, replace_snapshot: [] }, [snapshotType]);
  assert.ok(snapshot.id.length > 0);
  await pic.startCanister({ canisterId: fixture.canisterId, sender: governor });
  await upload(path, Buffer.from('changed after snapshot'));
  await upload('users/u/after-snapshot.bin', Buffer.from('new file'));
  assert.notDeepEqual(await download(path), replacement);
  await pic.stopCanister({ canisterId: fixture.canisterId, sender: governor });
  await management('load_canister_snapshot', IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) }), { canister_id: fixture.canisterId, snapshot_id: snapshot.id, sender_canister_version: [] });
  await pic.startCanister({ canisterId: fixture.canisterId, sender: governor });
  assert.deepEqual(await download(path), replacement);
  assert.equal((await actor.health()).total_bytes, BigInt(replacement.length));
  assert.equal((await actor.stable_storage_status()).allocated_bytes, allocated);
  assert.equal((await actor.http_request({ url: '/users/u/after-snapshot.bin', method: 'GET', headers: [], body: [] })).status_code, 404);
  actor.setPrincipal(other);
  assert.ok('Err' in await actor.delete_blob(path), 'snapshot restore must preserve owner authorization');
  actor.setPrincipal(owner);
  await management('delete_canister_snapshot', IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8) }), { canister_id: fixture.canisterId, snapshot_id: snapshot.id });
  // Real actor calls across two stores, including concurrent quota admission.
  const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: resolve(root, 'backend/club_domain/.mops/.build/club_domain.wasm'), sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  club.actor.setPrincipal(governor);
  ok(await club.actor.create_club('c1', 'Test club', 'test-club', [], []));
  // Uploads now require live membership in every quota mode.
  ok(await club.actor.add_role_grant(owner, 'c1', 'player', []));
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
  assert.ok('Err' in await club.actor.commit_media_quota('spoof'), 'unregistered principal cannot settle a reservation');
  assert.ok('Err' in await club.actor.cancel_media_quota('spoof', 'c1', 'gallery_photo', 1n, 0n), 'unregistered principal cannot refund a reservation');
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
  const reserveRetryPath = 'clubs/c1/photos/reserve-retry.jpg';
  await pic.stopCanister({ canisterId: club.canisterId, sender: governor });
  const unavailableBegins = await Promise.all([actor.begin_upload(reserveRetryPath, 'image/jpeg', 1n, 1), actor.begin_upload(reserveRetryPath, 'image/jpeg', 1n, 1)]);
  assert.ok(unavailableBegins.every(result => 'Err' in result));
  await pic.startCanister({ canisterId: club.canisterId, sender: governor });
  const resumedBegins = await Promise.all([actor.begin_upload(reserveRetryPath, 'image/jpeg', 1n, 1), actor.begin_upload(reserveRetryPath, 'image/jpeg', 1n, 1)]);
  const reserveRetryId = ok(resumedBegins[0]);
  assert.equal(ok(resumedBegins[1]), reserveRetryId, 'concurrent same-path retries must share one reservation');
  ok(await actor.put_chunk(reserveRetryId, 0, [45]));
  const concurrentFinals = await Promise.all([actor.finalize_upload(reserveRetryId), actor.finalize_upload(reserveRetryId)]);
  assert.deepEqual(ok(concurrentFinals[0]), ok(concurrentFinals[1]));
  assert.deepEqual(await download(reserveRetryPath), Buffer.from([45]));
  const nextCycle = ok(await actor.begin_upload('clubs/c1/photos/next-cycle.jpg', 'image/jpeg', 1n, 1));
  ok(await actor.put_chunk(nextCycle, 0, [43])); ok(await actor.finalize_upload(nextCycle));
  const recoveryPath = 'clubs/c1/photos/interrupted.jpg';
  const recoveryId = ok(await actor.begin_upload(recoveryPath, 'image/jpeg', 1n, 1));
  ok(await actor.put_chunk(recoveryId, 0, [44]));
  await pic.stopCanister({ canisterId: club.canisterId, sender: governor });
  assert.ok('Err' in await actor.finalize_upload(recoveryId), 'failed authority call must not acknowledge publication');
  assert.ok('Err' in await actor.abort_upload(recoveryId), 'uncertain commit cannot refund its slot');
  await pic.startCanister({ canisterId: club.canisterId, sender: governor });
  const recoveredRaw = await actor.finalize_upload(recoveryId); console.log("RECOVERED:", JSON.stringify(recoveredRaw, (_, v) => typeof v === "bigint" ? String(v) : v)); const recovered = ok(recoveredRaw);
  assert.deepEqual(ok(await actor.finalize_upload(recoveryId)), recovered);
  assert.deepEqual(await download(recoveryPath), Buffer.from([44]));
  assert.ok('Err' in await actor.abort_upload(recoveryId));
  // Exactly three slots were consumed this cycle despite repeated operations.
  // Fill the seven remaining slots, then prove a retry never double-charged.
  for (let i = 0; i < 7; i++) {
    const id = ok(await actor.begin_upload(`clubs/c1/photos/recovery-cap-${i}.jpg`, 'image/jpeg', 1n, 1));
    ok(await actor.put_chunk(id, 0, [46])); ok(await actor.finalize_upload(id));
  }
  assert.ok('Err' in await actor.begin_upload('clubs/c1/photos/recovery-over.jpg', 'image/jpeg', 1n, 1));
  // Recovery checkpoint includes BOTH media stores and the shared authority.
  // Drain and stop every participant before taking any snapshot. A restored
  // store alone would leave the committed ledger ahead of the file index.
  await pic.advanceTime(31 * 86_400_000); await pic.tick();
  const checkpointPath = 'clubs/c1/photos/checkpoint.jpg';
  const checkpointId = ok(await actor.begin_upload(checkpointPath, 'image/jpeg', 1n, 1));
  ok(await actor.put_chunk(checkpointId, 0, [51]));
  const checkpointResult = ok(await actor.finalize_upload(checkpointId));
  const participants = [fixture, second, club];
  const before = await Promise.all([actor.health(), second.actor.health(), actor.stable_storage_status(), actor.get_club_media_usage('c1'), second.actor.get_club_media_usage('c1')]);
  const recoveryInventory = { deploymentId: 'isolated-pocketic', authority: club.canisterId.toText(), stores: [fixture.canisterId.toText(), second.canisterId.toText()] };
  const loadedSnapshots = new Map();
  const recoveryAdapter = {
    // This inventory is the complete fixture, not a production registry adapter.
    readInventory: async () => recoveryInventory,
    stop: id => pic.stopCanister({ canisterId: Principal.fromText(id), sender: governor }),
    start: id => pic.startCanister({ canisterId: Principal.fromText(id), sender: governor }),
    status: async id => {
      const status = (await pic.canisterStatus({ canisterId: Principal.fromText(id), sender: governor })).status;
      return typeof status === 'string' ? status.toLowerCase() : Object.keys(status)[0];
    },
    takeSnapshot: async id => {
      const [saved] = await management('take_canister_snapshot', snapshotInput, { canister_id: Principal.fromText(id), replace_snapshot: [] }, [snapshotType]);
      return Buffer.from(saved.id).toString('hex');
    },
    loadSnapshot: async (id, saved) => {
      await management('load_canister_snapshot', IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) }), { canister_id: Principal.fromText(id), snapshot_id: Buffer.from(saved, 'hex'), sender_canister_version: [] });
      loadedSnapshots.set(id, saved);
    },
    // Require actual management-call success for every checkpoint participant.
    // Byte/owner/exact-quota semantic checks below follow the coordinated resume.
    verifyConsistency: async checkpoint => checkpoint.snapshots.every(entry => loadedSnapshots.get(entry.canisterId) === entry.snapshotId),
  };
  const coordinatedCheckpoint = await checkpointMedia(recoveryInventory, recoveryAdapter);
  const checkpoints = coordinatedCheckpoint.snapshots.map(entry => ({ canisterId: Principal.fromText(entry.canisterId), snapshotId: Buffer.from(entry.snapshotId, 'hex') }));
  assert.equal(coordinatedCheckpoint.snapshots.length, 3);
  for (const participant of participants) assert.equal(await recoveryAdapter.status(participant.canisterId.toText()), 'stopped');
  // Explicit test-only restart to write changes AFTER the checkpoint.
  for (const participant of [...participants].reverse()) await pic.startCanister({ canisterId: participant.canisterId, sender: governor });
  await upload(checkpointPath, Buffer.from([52]));
  const afterPath = 'clubs/c1/photos/rollback-second.jpg';
  const afterId = ok(await second.actor.begin_upload(afterPath, 'image/jpeg', 1n, 1));
  ok(await second.actor.put_chunk(afterId, 0, [53]));
  ok(await second.actor.finalize_upload(afterId));
  assert.deepEqual(await download(checkpointPath), Buffer.from([52]));
  assert.equal((await second.actor.get_content_hash(afterPath)).length, 1);
  await assert.rejects(restoreMedia(recoveryInventory, { ...coordinatedCheckpoint, snapshots: coordinatedCheckpoint.snapshots.slice(0, 2) }, recoveryAdapter), /coordinated snapshots/);
  assert.equal(await recoveryAdapter.status(club.canisterId.toText()), 'running', 'partial manifest rejected before mutation');
  await restoreMedia(recoveryInventory, coordinatedCheckpoint, recoveryAdapter);
  for (const participant of participants) assert.equal(await recoveryAdapter.status(participant.canisterId.toText()), 'stopped');
  await assert.rejects(resumeMedia(recoveryInventory, coordinatedCheckpoint, recoveryAdapter, false), /approval/);
  // All restores complete before any writer resumes; authority starts first.
  await resumeMedia(recoveryInventory, coordinatedCheckpoint, recoveryAdapter, true);
  assert.deepEqual(await download(checkpointPath), Buffer.from([51]));
  assert.deepEqual(ok(await actor.get_upload_outcome(checkpointId)), [checkpointResult]);
  assert.deepEqual(await second.actor.get_content_hash(afterPath), []);
  assert.ok('Err' in await second.actor.get_upload_outcome(afterId));
  assert.deepEqual(await Promise.all([actor.health(), second.actor.health(), actor.stable_storage_status(), actor.get_club_media_usage('c1'), second.actor.get_club_media_usage('c1')]), before);
  actor.setPrincipal(other);
  assert.ok('Err' in await actor.get_upload_outcome(checkpointId), 'restored journal remains owner-only');
  assert.ok('Err' in await actor.delete_blob(checkpointPath));
  actor.setPrincipal(owner);
  // One checkpoint charge survives; exactly nine uploads remain across
  // both stores. If only media had rolled back the advanced ledger would fail.
  for (let i = 0; i < 9; i++) {
    const store = i % 2 ? second.actor : actor;
    const id = ok(await store.begin_upload(`clubs/c1/photos/restored-${i}.jpg`, 'image/jpeg', 1n, 1));
    ok(await store.put_chunk(id, 0, [54]));
    ok(await store.finalize_upload(id));
  }
  assert.ok('Err' in await second.actor.begin_upload('clubs/c1/photos/restored-over.jpg', 'image/jpeg', 1n, 1));
  for (const saved of checkpoints) await management('delete_canister_snapshot', IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8) }), { canister_id: saved.canisterId, snapshot_id: saved.snapshotId });
  // Lose the CLIENT acknowledgement only AFTER real canister finalization.
  // No authority mock: the replica commits ciphertext and the shared ledger.
  // This does not simulate a lost inter-canister callback.
  await pic.advanceTime(31 * 86_400_000); await pic.tick();
  const lostAckPath = 'clubs/c1/photos/lost-finalize-ack.jpg';
  const lostAckId = ok(await actor.begin_upload(lostAckPath, 'image/jpeg', 1n, 1));
  ok(await actor.put_chunk(lostAckId, 0, [61]));
  const beforeLostAck = (await actor.health()).total_bytes;
  await assert.rejects(async () => {
    ok(await actor.finalize_upload(lostAckId));
    throw new Error('Injected client transport loss after real commit');
  }, /Injected client transport loss after real commit/);
  const lostAckOutcome = ok(await actor.get_upload_outcome(lostAckId));
  assert.equal(lostAckOutcome.length, 1, 'lost client response must leave an owner-readable committed outcome');
  const [lostAckResult] = lostAckOutcome;
  assert.deepEqual(lostAckResult, { path: lostAckPath, content_hash: createHash('sha256').update(Buffer.from([61])).digest('hex'), content_length: 1n });
  assert.deepEqual(await download(lostAckPath), Buffer.from([61]));
  assert.equal((await actor.health()).total_bytes, beforeLostAck + 1n);
  actor.setPrincipal(other);
  assert.ok('Err' in await actor.get_upload_outcome(lostAckId));
  assert.ok('Err' in await actor.finalize_upload(lostAckId));
  assert.ok('Err' in await actor.abort_upload(lostAckId));
  actor.setPrincipal(owner);
  // A restart/upgrade between lost response and retry cannot lose the journal.
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  const acknowledgedRetries = await Promise.all([actor.finalize_upload(lostAckId), actor.finalize_upload(lostAckId)]);
  for (const result of acknowledgedRetries) assert.deepEqual(ok(result), lostAckResult);
  assert.deepEqual(ok(await actor.get_upload_outcome(lostAckId)), [lostAckResult]);
  assert.equal((await actor.health()).total_bytes, beforeLostAck + 1n, 'retry must not publish bytes twice');
  assert.ok('Err' in await actor.abort_upload(lostAckId), 'lost acknowledgement never permits a refund');
  for (let i = 0; i < 9; i++) {
    const store = i % 2 ? second.actor : actor;
    const id = ok(await store.begin_upload(`clubs/c1/photos/lost-ack-cap-${i}.jpg`, 'image/jpeg', 1n, 1));
    ok(await store.put_chunk(id, 0, [62])); ok(await store.finalize_upload(id));
  }
  assert.ok('Err' in await second.actor.begin_upload('clubs/c1/photos/lost-ack-over.jpg', 'image/jpeg', 1n, 1), 'lost response and repeated finalization consume exactly one of ten slots');
  // Preserve an UNCERTAIN commit across EOP upgrade and recover via the actual
  // governor reconciler instead of requiring the original client to return.
  await pic.advanceTime(31 * 86_400_000); await pic.tick();
  const upgradeRecoveryPath = 'clubs/c1/photos/upgrade-uncertain.jpg';
  const upgradeRecoveryId = ok(await actor.begin_upload(upgradeRecoveryPath, 'image/jpeg', 1n, 1));
  ok(await actor.put_chunk(upgradeRecoveryId, 0, [63]));
  await pic.stopCanister({ canisterId: club.canisterId, sender: governor });
  assert.ok('Err' in await actor.finalize_upload(upgradeRecoveryId));
  assert.deepEqual(await download(upgradeRecoveryPath), Buffer.from([63]), 'uncertain finalization has already stored ciphertext');
  assert.ok('Err' in await actor.get_upload_outcome(upgradeRecoveryId));
  await pic.upgradeCanister({ canisterId: fixture.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.ok('Err' in await actor.abort_upload(upgradeRecoveryId), 'upgrade must preserve the uncertain-commit refund fence');
  assert.ok('Err' in await actor.reconcile_upload_operations(''), 'ordinary upload owner cannot run governor recovery');
  await pic.startCanister({ canisterId: club.canisterId, sender: governor });
  actor.setPrincipal(governor);
  // Earlier cycles leave terminal rows in the bounded journal; follow every
  // returned cursor rather than assuming the target is on the first page.
  let reconcileCursor = '';
  let reconcilePages = 0;
  let attempted = 0n;
  do {
    const page = ok(await actor.reconcile_upload_operations(reconcileCursor));
    attempted += page.attempted;
    reconcileCursor = page.cursor;
    assert.ok(++reconcilePages <= 20, 'bounded fixture recovery must finish');
  } while (reconcileCursor);
  assert.equal(attempted, 1n, 'governor recovery must settle the one uncertain upload');
  actor.setPrincipal(owner);
  const recoveredOutcome = ok(await actor.get_upload_outcome(upgradeRecoveryId));
  assert.equal(recoveredOutcome.length, 1);
  assert.deepEqual(ok(await actor.finalize_upload(upgradeRecoveryId)), recoveredOutcome[0]);
  assert.deepEqual(await download(upgradeRecoveryPath), Buffer.from([63]));
  assert.ok('Err' in await actor.abort_upload(upgradeRecoveryId));
  for (let i = 0; i < 9; i++) {
    const store = i % 2 ? second.actor : actor;
    const id = ok(await store.begin_upload(`clubs/c1/photos/upgrade-recovery-cap-${i}.jpg`, 'image/jpeg', 1n, 1));
    ok(await store.put_chunk(id, 0, [64])); ok(await store.finalize_upload(id));
  }
  assert.ok('Err' in await actor.begin_upload('clubs/c1/photos/upgrade-recovery-over.jpg', 'image/jpeg', 1n, 1), 'upgrade and governor recovery preserve exactly one allowance charge');
  await pic.advanceTime(181 * 86_400_000); await pic.tick(10);
  const expired = await actor.http_request({ url: '/clubs/c1/photos/0.jpg', method: 'GET', headers: [], body: [] });
  assert.equal(expired.status_code, 404, 'known-free club ciphertext must expire after six months');
  assert.deepEqual(await download(path), replacement, 'personal media without a club retention rule is retained');
  console.log('PASS: authenticated upload, streaming read-back, migration integrity/idempotency, owner denial, replacement/delete/reuse and EOP upgrade preservation.');
  console.log('PASS: real two-store freeze/import/activation, denied spoofed reservation, 10 shared slots including pending writes, idempotent begin/finalize, release/refund and 30-day boundary.');
  console.log('PASS: controller-only snapshot restore preserves Region bytes/allocator/owner; unavailable quota commit retries publish once without refund.');
  console.log('PASS: coordinated two-store and quota-authority snapshot rollback restores bytes, owner-only outcomes and exactly nine remaining shared allowances.');
  console.log('PASS: recovery coordinator uses real controller stop/status/snapshot/load/start calls; rejects partial manifests before mutation and requires explicit resume approval.');
  console.log('PASS: real commit followed by injected client acknowledgement loss survives EOP upgrade, denies other owners, retries without duplicate bytes and consumes exactly one shared slot.');
  console.log('PASS: uncertain commit survives EOP upgrade; governor-only bounded journal recovery settles it with exactly one shared allowance charge.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}