// Combined two-group photo/upload/chat-notification/revocation acceptance.
// Uses five real domains per group, not a complete production provisioning composition.
// No account admission flags, external sends or live traffic.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as blobIdl } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as queueIdl } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
import { idlFactory as messageIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { deliverPushItem } from '../../scripts/icp-push-batch.mjs';
const p = n => Principal.fromUint8Array(new Uint8Array([n, 1]));
const governor = p(1), removed = p(2), retained = p(3), worker = p(4), stranger = p(5);
const ok = r => { assert.ok('Ok' in r, String(r.Err)); return r.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const setup = (idlFactory, wasm, environmentVariables = []) => pic.setupCanister({ idlFactory, wasm, environmentVariables, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  const directory = await setup(queueIdl, process.env.NOTIFICATION_QUEUE_WASM);
  directory.actor.setPrincipal(governor); ok(await directory.actor.grant_worker(worker));
  directory.actor.setPrincipal(removed); ok(await directory.actor.register_device_token('android', 'removed-device', [], []));
  directory.actor.setPrincipal(retained); ok(await directory.actor.register_device_token('ios', 'retained-device', [], []));
  const groups = [];
  for (const id of ['club-a', 'club-b']) {
    const club = await setup(clubIdl, process.env.CLUB_DOMAIN_WASM);
    const queue = await setup(queueIdl, process.env.NOTIFICATION_QUEUE_WASM);
    const messaging = await setup(messageIdl, process.env.MESSAGING_DOMAIN_WASM);
    for (const s of [club, queue, messaging]) s.actor.setPrincipal(governor);
    ok(await club.actor.create_club(id, id, id, [], []));
    for (const user of [removed, retained]) ok(await club.actor.add_role_grant(user, id, 'player', []));
    ok(await queue.actor.set_club_domain_canister(club.canisterId));
    ok(await queue.actor.set_messaging_domain_canister(messaging.canisterId));
    ok(await queue.actor.grant_worker(worker));
    ok(await messaging.actor.set_club_domain_canister(club.canisterId));
    ok(await messaging.actor.set_notification_queue_canister(queue.canisterId));
    const pii = await setup(piiIdl, process.env.PII_ACCESS_CONTROL_WASM, [{ name: 'VETKD_KEY_NAME', value: 'key_1' }]);
    const blob = await setup(blobIdl, process.env.MEDIA_BLOB_STORE_WASM, [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }]);
    pii.actor.setPrincipal(governor); blob.actor.setPrincipal(governor);
    ok(await pii.actor.set_club_domain_canister(club.canisterId));
    ok(await blob.actor.set_club_domain_canister(club.canisterId));
    const verification = DerivedPublicKey.deserialize(Uint8Array.from(await pii.actor.pii_vetkey_verification_key()));
    const identity = new TextEncoder().encode(`clubmedia:${id}\u001fblob`);
    const plain = new TextEncoder().encode(`Private integrated photo ${id}`);
    const cipher = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(identity), plain, IbeSeed.random()).serialize();
    const path = `clubs/${id}/gallery/control.jpg`;
    const upload = async (user, suffix) => {
      blob.actor.setPrincipal(user);
      const uploadId = ok(await blob.actor.begin_upload(`clubs/${id}/gallery/${suffix}.jpg`, 'image/jpeg', BigInt(cipher.length), 1));
      ok(await blob.actor.put_chunk(uploadId, 0, cipher)); return uploadId;
    };
    const read = async user => {
      pii.actor.setPrincipal(user);
      const transport = TransportSecretKey.random();
      const result = await pii.actor.get_club_media_vetkey(id, transport.publicKeyBytes());
      if ('Err' in result) return false;
      const key = EncryptedVetKey.deserialize(Uint8Array.from(result.Ok)).decryptAndVerify(transport, verification, identity);
      const response = await blob.actor.http_request({ url: `/${path}`, method: 'GET', headers: [], body: new Uint8Array() });
      assert.equal(response.status_code, 200);
      assert.deepEqual(IbeCiphertext.deserialize(Uint8Array.from(response.body)).decrypt(key), plain);
      return true;
    };
    const control = await upload(removed, 'control'); ok(await blob.actor.finalize_upload(control));
    assert.equal(await read(removed), true); assert.equal(await read(retained), true);
    const pendingUpload = await upload(removed, 'interrupted');
    const conversation = ok(await messaging.actor.ensure_conversation(id, ['team-' + id], [removed, retained]));
    messaging.actor.setPrincipal(removed);
    const beforeMessage = ok(await messaging.actor.send_message(conversation.id, 'before removal', 'before-removal', [], []));
    const scheduled = ok(await messaging.actor.register_scheduled_message(conversation.id, 'scheduled before removal', 9999999999999n));
    const dm = ok(await messaging.actor.get_or_create_dm(retained));
    // Competition audience is not membership in its host club.
    messaging.actor.setPrincipal(governor);
    const competition = ok(await messaging.actor.create_group_with_roles(id, [], 'Competition officials', 'competition', [[governor, 'admin'], [removed, 'member']]));
    ok(await messaging.actor.grant_competition_admin(competition.conversation_id, removed));
    messaging.actor.setPrincipal(removed);
    ok(await messaging.actor.send_message(competition.conversation_id, 'competition control', 'competition-before', [], []));
    assert.equal(ok(await messaging.actor.list_messages_page(conversation.id, [], 10)).messages.some(m => m.id === beforeMessage.id), true);
    messaging.actor.setPrincipal(governor);
    // Clear control-send notifications before the four deterministic audience rows.
    queue.actor.setPrincipal(worker);
    for (const row of ok(await queue.actor.claim(100000n, 50))) ok(await queue.actor.acknowledge(row.id, row.idempotency_key));
    queue.actor.setPrincipal(governor);
    // Same IDs in distinct queues; canonical roster IDs dedupe on-chain.
    assert.equal(ok(await queue.actor.fan_out([removed.toText(), ' principal:' + removed.toText() + ' ', retained.toText()], id, 'photo_added', 'Private photo', 'photo', [])), 2);
    assert.equal(ok(await queue.actor.fan_out([removed.toText(), retained.toText()], id, 'photo_added', 'Private photo', 'photo', [])), 0);
    assert.equal(ok(await queue.actor.record_chat_notify_batch('message', conversation.id, governor.toText(), 'Private chat', [removed.toText(), retained.toText()], [])), 2);
    queue.actor.setPrincipal(worker);
    const claimed = ok(await queue.actor.claim(100000n, 50)); assert.equal(claimed.length, 4);
    for (const row of claimed) assert.equal(ok(await queue.actor.authorize_delivery(row.id, row.idempotency_key)), true);
    groups.push({ id, club, queue, messaging, pii, blob, read, upload, pendingUpload, claimed, conversation, beforeMessage, scheduled, dm, competition });
  }
  const [a, b] = groups;
  a.club.actor.setPrincipal(governor); ok(await a.club.actor.remove_member(a.id, removed));
  assert.equal(await a.read(removed), false, 'Fresh key denied in removed club');
  const deniedMutation = async call => {
    let denied = false;
    try { const result = await call(); denied = !!result && 'Err' in result; } catch { denied = true; }
    assert.equal(denied, true, 'Removed club operation must be denied');
  };
  const assertChatRevoked = async group => {
    const actor = group.messaging.actor; actor.setPrincipal(removed);
    await deniedMutation(() => actor.send_message(group.conversation.id, 'blocked', 'blocked-direct', [], []));
    await deniedMutation(() => actor.list_messages_page(group.conversation.id, [], 10));
    await deniedMutation(() => actor.open_conversation(group.conversation.id, 10));
    await deniedMutation(() => actor.search_messages(group.conversation.id, 'before', 10));
    await deniedMutation(() => actor.read_account_list_messages_page(group.conversation.id, [], 10));
    await deniedMutation(() => actor.toggle_reaction(group.beforeMessage.id, 'x'));
    await deniedMutation(() => actor.update_message(group.beforeMessage.id, 'blocked edit'));
    await deniedMutation(() => actor.forward_message(group.beforeMessage.id, group.dm.id));
    const dmMessage = ok(await actor.send_message(group.dm.id, 'DM still works', 'dm-control', [], []));
    await deniedMutation(() => actor.forward_message(dmMessage.id, group.conversation.id));
    await deniedMutation(() => actor.register_scheduled_message(group.conversation.id, 'blocked schedule', 9999999999999n));
    await deniedMutation(() => actor.replay_scheduled_message(group.scheduled.id));
    await deniedMutation(() => actor.ensure_club_admin_thread(group.id, removed));
    await deniedMutation(() => actor.create_conversation(group.id, [], [removed, retained]));
    assert.equal(ok(await actor.recent_conversations(removed, 100)).some(c => c.conversation_id === group.conversation.id), false);
    assert.equal(ok(await actor.list_messages_page(group.dm.id, [], 10)).messages.some(m => m.id === dmMessage.id), true);
    const competitionMessage = ok(await actor.send_message(group.competition.conversation_id, 'competition still works', 'competition-control', [], []));
    assert.equal(ok(await actor.list_messages_page(group.competition.conversation_id, [], 10)).messages.some(m => m.id === competitionMessage.id), true);
    actor.setPrincipal(group.queue.canisterId);
    await deniedMutation(() => actor.deliver_scheduled_message(removed, group.conversation.id, 'blocked delegated', 'blocked-delegated', [], []));
    assert.equal(await actor.read_account_can_read_digest(removed, group.conversation.id), false);
    assert.equal(await actor.read_account_can_read_digest(retained, group.conversation.id), true);
    actor.setPrincipal(retained);
    const page = ok(await actor.list_messages_page(group.conversation.id, [], 100));
    assert.equal(page.messages.some(m => m.id === group.beforeMessage.id), true, 'Historical messages stay available to retained members');
    assert.equal(page.messages.some(m => m.body.startsWith('blocked')), false, 'Denied writes leave no chat messages');
  };
  await assertChatRevoked(a);
  a.blob.actor.setPrincipal(removed);
  await deniedMutation(() => a.blob.actor.put_chunk(a.pendingUpload, 0, new Uint8Array([1])));
  await deniedMutation(() => a.blob.actor.finalize_upload(a.pendingUpload));
  await deniedMutation(() => a.upload(removed, 'after-removal'));
  assert.equal(await a.read(retained), true); assert.equal(await b.read(removed), true);
  const other = await b.upload(removed, 'other-club'); ok(await b.blob.actor.finalize_upload(other));
  directory.actor.setPrincipal(worker);
  const tokens = ok(await directory.actor.list_device_tokens([removed.toText(), retained.toText()])); assert.equal(tokens.length, 2);
  // No per-group device copies are needed. Send uses real source-queue auth.
  const sent = [];
  for (const group of groups) {
    group.queue.actor.setPrincipal(worker);
    for (const row of group.claimed) {
      const devices = tokens.filter(t => t.user === row.user);
      const result = await deliverPushItem(group.queue.actor, row, devices, async t => { sent.push(group.id + ':' + t.token); return null; });
      const expected = !(group.id === 'club-a' && row.user === removed.toText());
      assert.equal(result.status, expected ? 'delivered' : 'denied');
      if (expected) ok(await group.queue.actor.acknowledge(row.id, row.idempotency_key));
      else ok(await group.queue.actor.fail(row.id, 'Club access revoked', []));
    }
  }
  assert.equal(sent.length, 6); assert.ok(!sent.includes('club-a:removed-device'));
  assert.ok(sent.includes('club-b:removed-device'));
  a.queue.actor.setPrincipal(worker);
  for (const row of ok(await a.queue.actor.claim(100000n, 50))) ok(await a.queue.actor.acknowledge(row.id, row.idempotency_key));
  a.queue.actor.setPrincipal(governor);
  ok(await a.queue.actor.enqueue('outage', retained.toText(), a.id, 'club_news', 'Preserve original body', 'outage-key'));
  const chatId = a.claimed.find(n => n.kind === 'message_chat').club;
  ok(await a.queue.actor.record_chat_notify_batch('chat-outage', chatId, governor.toText(), 'Private retry chat', [retained.toText()], []));
  a.queue.actor.setPrincipal(worker); const outageRows = ok(await a.queue.actor.claim(100000n, 50));
  const outage = outageRows.find(n => n.id === 'outage'); assert.ok(outage);
  const chatOutage = outageRows.find(n => n.kind === 'message_chat' && n.club === chatId); assert.ok(chatOutage);
  await pic.stopCanister({ canisterId: a.club.canisterId, sender: governor });
  assert.ok('Err' in await a.queue.actor.authorize_delivery(outage.id, outage.idempotency_key));
  const chatDenied = await a.queue.actor.authorize_delivery(chatOutage.id, chatOutage.idempotency_key);
  assert.ok('Err' in chatDenied || chatDenied.Ok === false, 'Unavailable club authority cannot authorize chat delivery');
  const retried = ok(await a.queue.actor.fail(outage.id, 'Temporary outage', [0n])); assert.equal(retried.body, 'Preserve original body');
  a.messaging.actor.setPrincipal(retained);
  await deniedMutation(() => a.messaging.actor.send_message(a.conversation.id, 'outage blocked', 'outage-blocked', [], []));
  await deniedMutation(() => a.messaging.actor.list_messages_page(a.conversation.id, [], 10));
  await pic.startCanister({ canisterId: a.club.canisterId, sender: governor });
  assert.equal(ok(await a.queue.actor.authorize_delivery(chatOutage.id, chatOutage.idempotency_key)), true);
  const reclaims = ok(await a.queue.actor.claim(100000n, 50)); assert.ok(reclaims.some(n => n.id === 'outage'));
  assert.equal(ok(await a.queue.actor.authorize_delivery('outage', 'outage-key')), true);
  // Claim ownership, not knowledge of IDs/keys, controls private authorization.
  a.queue.actor.setPrincipal(stranger); await assert.rejects(() => a.queue.actor.authorize_delivery('outage', 'outage-key'));
  a.queue.actor.setPrincipal(worker); assert.ok('Err' in await a.queue.actor.authorize_delivery('outage', 'wrong-key'));
  assert.equal(ok(await a.queue.actor.recover()), 2);
  assert.ok('Err' in await a.queue.actor.authorize_delivery('outage', 'outage-key'));
  assert.equal(ok(await a.queue.actor.claim(100000n, 50)).length, 2);
  assert.equal(ok(await a.queue.actor.authorize_delivery('outage', 'outage-key')), true);
  // Upgrade the same wired services; preserve encryption authority and club denial.
  const artifacts = [
    ['club', process.env.CLUB_DOMAIN_WASM], ['pii', process.env.PII_ACCESS_CONTROL_WASM],
    ['blob', process.env.MEDIA_BLOB_STORE_WASM], ['messaging', process.env.MESSAGING_DOMAIN_WASM],
    ['queue', process.env.NOTIFICATION_QUEUE_WASM],
  ];
  for (const group of groups) {
    for (const [domain, wasm] of artifacts) {
      await pic.upgradeCanister({ canisterId: group[domain].canisterId, wasm, sender: governor,
        upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
        arg: IDL.encode([IDL.Principal], [governor]) });
    }
  }
  await assertChatRevoked(a);
  assert.equal(await a.read(removed), false); assert.equal(await a.read(retained), true);
  assert.equal(await b.read(removed), true);
  await deniedMutation(() => a.upload(removed, 'after-upgrade'));
  const afterUpgrade = await b.upload(removed, 'after-upgrade'); ok(await b.blob.actor.finalize_upload(afterUpgrade));
  a.queue.actor.setPrincipal(worker);
  assert.equal(ok(await a.queue.actor.authorize_delivery('outage', 'outage-key')), true);
  a.queue.actor.setPrincipal(governor);
  assert.equal(ok(await a.queue.actor.fan_out([retained.toText()], a.id, 'photo_added', 'Private photo', 'photo', [])), 0);
  directory.actor.setPrincipal(worker);
  assert.equal(ok(await directory.actor.list_device_tokens([removed.toText(), retained.toText()])).length, 2);
  // Real human sends and read-back in the same upgraded groups, not fabricated message rows.
  console.log('PASS: same-group photos, uploads, notification authorization and five-service upgrade preservation; checking direct chat access next.');
  a.messaging.actor.setPrincipal(removed);
  await deniedMutation(() => a.messaging.actor.send_message(a.conversation.id, 'must be denied', 'denied-after-upgrade', [], []));
  a.messaging.actor.setPrincipal(retained);
  const retainedMessage = ok(await a.messaging.actor.send_message(a.conversation.id, 'retained member message', 'retained-after-upgrade', [], []));
  assert.equal(ok(await a.messaging.actor.list_messages_page(a.conversation.id, [], 10)).messages.some(m => m.id === retainedMessage.id), true);
  b.messaging.actor.setPrincipal(removed);
  const otherMessage = ok(await b.messaging.actor.send_message(b.conversation.id, 'other club message', 'other-after-upgrade', [], []));
  assert.equal(ok(await b.messaging.actor.list_messages_page(b.conversation.id, [], 10)).messages.some(m => m.id === otherMessage.id), true);
  console.log('PASS: same two groups, real encrypted photo decrypt/fresh-key denial, pending/new uploads denied only in removed club, retained/other-club photos/uploads, shared-device photo/chat notifications, six permitted stub sends, retries/outage/dedupe and all five service upgrades preserving keys and denial. Full provisioning/app/browser/native/FCM acceptance NOT established.');
  console.log('PASS: real retained/other-club chat sends read back after upgrades; removed-club sender denied. FCM sends stubbed; no live services.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }