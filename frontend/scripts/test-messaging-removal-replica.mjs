// Local-only real old-module upgrade and original-human drain regression.
// No deploy flags, production activation, external push or global completion.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as chatIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';

for (const key of ['IDENTITY_ACCESS_WASM', 'MESSAGING_BEFORE_WASM', 'MESSAGING_DOMAIN_WASM', 'MESSAGING_REMOVAL_RELAY_WASM', 'POCKET_IC_BIN']) {
  assert.ok(process.env[key], `${key} required; never silently skip this proof`);
}
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
assert.equal(createHash('sha256').update(readFileSync(process.env.MESSAGING_BEFORE_WASM)).digest('hex'),
  '96d673b043f531376c12a6e902b8f5b5de2aa27d551150b8cb96d262924d8a75',
  'Upgrade proof requires the real pre-receiver module, not the updated actor twice');
const governor = p(1), removed = p(2), survivor = p(3), stranger = p(4);
const ok = r => { assert.ok('Ok' in r, String(r.Err)); return r.Ok; };
const denied = async operation => {
  let blocked = false;
  try { const result = await operation(); blocked = Boolean(result && 'Err' in result); } catch { blocked = true; }
  assert.ok(blocked, 'Fenced original human must be denied');
};
const requestType = IDL.Record({ account_id: IDL.Text, generation: IDL.Nat64, inventory_digest: IDL.Vec(IDL.Nat8), subjects: IDL.Vec(IDL.Principal) });
const receiptType = IDL.Record({ request: requestType, receiver: IDL.Principal, outstanding: IDL.Nat });
// The relay is both consensus eligibility fixture and authenticated coordinator.
// It deliberately continues returning Eligible after fencing, so denial must
// come from persistent receiver state, not a deleted identity or role row.
const relayIdl = ({ IDL: I }) => I.Service({
  hold_notifications: I.Func([], [], []), release_notifications: I.Func([], [], []),
  notification_progress: I.Func([], [I.Nat, I.Bool], ['query']),
  hold_on: I.Func([I.Nat], [], []), release: I.Func([], [], []),
  progress: I.Func([], [I.Nat, I.Bool], ['query']), pulse: I.Func([], [], []),
  prepare: I.Func([I.Principal, requestType], [I.Variant({ Ok: I.Null, Err: I.Text })], []),
  drain: I.Func([I.Principal, requestType], [I.Variant({ Ok: receiptType, Err: I.Text })], []),
});
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.IDENTITY_ACCESS_WASM,
    sender: governor, controllers: [governor], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  for (const subject of [governor, removed, survivor]) {
    identity.actor.setPrincipal(subject); ok(await identity.actor.register_account());
  }
  const relay = await pic.setupCanister({ idlFactory: relayIdl, wasm: process.env.MESSAGING_REMOVAL_RELAY_WASM,
    sender: governor, controllers: [governor] });
  const environmentVariables = [
    { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' },
    { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: relay.canisterId.toText() },
  ];
  const chat = await pic.setupCanister({ idlFactory: chatIdl, wasm: process.env.MESSAGING_BEFORE_WASM,
    sender: governor, controllers: [governor], environmentVariables,
    arg: IDL.encode([IDL.Principal], [governor]) });
  chat.actor.setPrincipal(governor);
  ok(await chat.actor.set_club_domain_canister(relay.canisterId));
  ok(await chat.actor.set_notification_queue_canister(relay.canisterId));
  const conversation = ok(await chat.actor.create_conversation('club', [], [governor, removed, survivor]));
  chat.actor.setPrincipal(removed);
  const original = ok(await chat.actor.send_message(conversation.id, 'existing history', 'before', [], []));
  const scheduled = ok(await chat.actor.register_scheduled_message(conversation.id, 'pending scheduled', 1n));
  assert.equal(ok(await chat.actor.read_account_list_messages_page(conversation.id, [], 10)).messages.length, 1);
  await pic.upgradeCanister({ canisterId: chat.canisterId, wasm: process.env.MESSAGING_DOMAIN_WASM,
    sender: governor, arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.equal(ok(await chat.actor.read_account_list_messages_page(conversation.id, [], 10)).messages[0].id, original.id);
  // Deliberate legacy refusal must occur before any persistent hold/await.
  for (let attempt = 0; attempt < 3; attempt++) {
    await denied(() => chat.actor.list_messages(conversation.id, []));
  }
  chat.actor.setPrincipal(governor);
  ok(await chat.actor.set_transfer_fence('club', true));
  const snapshot = ok(await chat.actor.export_club_snapshot_page('club', 0n, 10n));
  ok(await chat.actor.set_transfer_fence('club', false));
  const request = { account_id: 'removed-account', generation: 7n, inventory_digest: new Uint8Array(32).fill(9), subjects: [removed] };
  relay.actor.setPrincipal(governor);
  const prepare = () => relay.actor.prepare(chat.canisterId, request);
  const drain = () => relay.actor.drain(chat.canisterId, request);
  const waitForHold = async n => {
    for (let round = 0; round < 80; round++) {
      await pic.tick(1);
      const [count, released] = await relay.actor.progress();
      if (count === BigInt(n) && !released) return;
    }
    assert.fail('Did not observe actual held authorization callback');
  };
  const submit = async (method, args, sender = removed) => {
    const signature = chatIdl({ IDL })._fields.find(([name]) => name === method)?.[1];
    assert.ok(signature);
    const pending = await pic.client.submitCall({ canisterId: chat.canisterId, sender, method,
      payload: new Uint8Array(IDL.encode(signature.argTypes, args)) });
    return async () => {
      const reply = await pic.client.awaitCall(pending);
      return IDL.decode(signature.retTypes, reply.body)[0];
    };
  };
  // Hold the membership check after eligible admission; then fence the human.
  await relay.actor.hold_on(1n);
  const pending = await submit('send_message', [conversation.id, 'must not appear', 'held', [], []]);
  await waitForHold(1);
  chat.actor.setPrincipal(stranger); await denied(() => chat.actor.prepare_account_removal(request));
  ok(await prepare());
  const live = ok(await drain());
  assert.equal(live.receiver.toText(), chat.canisterId.toText());
  assert.ok(live.outstanding > 0n, 'Held original-human operation must be visible');
  ok(await prepare()); // Lost preparation reply: exact retry is harmless.
  assert.equal(ok(await drain()).outstanding, live.outstanding);
  await denied(() => relay.actor.prepare(chat.canisterId, { ...request, generation: 8n }));
  await relay.actor.release(); await denied(pending);
  assert.equal(ok(await drain()).outstanding, 0n, 'Drain becomes zero only after denial callback settles');
  chat.actor.setPrincipal(removed);
  await denied(() => chat.actor.read_account_list_messages_page(conversation.id, [], 10));
  await denied(() => chat.actor.send_message(conversation.id, 'retry', 'held', [], []));
  await denied(() => chat.actor.toggle_reaction(original.id, 'x'));
  chat.actor.setPrincipal(governor);
  await denied(() => chat.actor.replay_scheduled_message(scheduled.id));
  assert.ok('err' in await chat.actor.rekey_principal(removed, stranger, true));
  assert.ok('err' in await chat.actor.merge_principal(stranger, removed, false));
  await denied(() => chat.actor.read_account_recent_conversations(removed, 10));
  await denied(() => chat.actor.read_account_unread_count_by_club(removed));
  ok(await chat.actor.set_transfer_fence('club', true));
  await denied(() => chat.actor.import_club_snapshot_page('club', snapshot));
  ok(await chat.actor.set_transfer_fence('club', false));
  chat.actor.setPrincipal(survivor);
  const history = ok(await chat.actor.read_account_list_messages_page(conversation.id, [], 10));
  assert.deepEqual(history.messages.map(m => m.idempotency_key), ['before']);
  ok(await chat.actor.send_message(conversation.id, 'survivor still works', 'survivor', [], []));
  // Restart/upgrade before coordinator retries must retain denial without
  // touching historical messages, unrelated account or identity authority.
  await pic.upgradeCanister({ canisterId: chat.canisterId, wasm: process.env.MESSAGING_DOMAIN_WASM,
    sender: governor, arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  chat.actor.setPrincipal(removed);
  await denied(() => chat.actor.read_account_list_messages_page(conversation.id, [], 10));
  await denied(() => chat.actor.send_message(conversation.id, 'after restart', 'restart', [], []));
  assert.equal(ok(await drain()).outstanding, 0n);
  const snapshotType = IDL.Record({ id: IDL.Vec(IDL.Nat8), taken_at_timestamp: IDL.Nat64, total_size: IDL.Nat64 });
  const management = async (method, type, input, outputs = []) => {
    const reply = await pic.updateCall({ canisterId: Principal.managementCanister(), sender: governor,
      method, arg: IDL.encode([type], [input]) });
    return IDL.decode(outputs, reply);
  };
  await pic.stopCanister({ canisterId: chat.canisterId, sender: governor });
  const [recoverySnapshot] = await management('take_canister_snapshot',
    IDL.Record({ canister_id: IDL.Principal, replace_snapshot: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
    { canister_id: chat.canisterId, replace_snapshot: [] }, [snapshotType]);
  await management('load_canister_snapshot',
    IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) }),
    { canister_id: chat.canisterId, snapshot_id: recoverySnapshot.id, sender_canister_version: [] });
  await pic.startCanister({ canisterId: chat.canisterId, sender: governor });
  chat.actor.setPrincipal(removed);
  await denied(() => chat.actor.read_account_list_messages_page(conversation.id, [], 10));
  assert.equal(ok(await drain()).outstanding, 0n);
  chat.actor.setPrincipal(survivor);
  assert.equal(ok(await chat.actor.read_account_list_messages_page(conversation.id, [], 10)).messages.length, 2);
  // Detached notifications keep an original-author hold after send returns.
  // This observes queue work, not FCM delivery or receipt completion elsewhere.
  const notifying = p(5);
  chat.actor.setPrincipal(governor);
  const notificationConversation = ok(await chat.actor.create_conversation('club', [], [governor, notifying]));
  await relay.actor.hold_notifications();
  chat.actor.setPrincipal(notifying);
  ok(await chat.actor.send_message(notificationConversation.id, 'notification hold', 'notify', [], []));
  let observedNotification = false;
  for (let round = 0; round < 80; round++) {
    await pic.tick(1);
    const [count, held] = await relay.actor.notification_progress();
    if (count > 0n && held) { observedNotification = true; break; }
  }
  assert.ok(observedNotification, 'Detached queue call was actually observed');
  const notificationRequest = { ...request, account_id: 'notification-author', generation: 8n, subjects: [notifying] };
  ok(await relay.actor.prepare(chat.canisterId, notificationRequest));
  assert.ok(ok(await relay.actor.drain(chat.canisterId, notificationRequest)).outstanding > 0n);
  await relay.actor.release_notifications();
  let notificationDrained = false;
  for (let round = 0; round < 80; round++) {
    await pic.tick(1);
    if (ok(await relay.actor.drain(chat.canisterId, notificationRequest)).outstanding === 0n) { notificationDrained = true; break; }
  }
  assert.ok(notificationDrained, 'Original-author hold releases only after queue settles');
  // Ordinary deployment: preparation is unavailable; no rehearsal release.
  await pic.updateCanisterSettings({ canisterId: chat.canisterId, sender: governor, environmentVariables: [] });
  await pic.upgradeCanister({ canisterId: chat.canisterId, wasm: process.env.MESSAGING_DOMAIN_WASM,
    sender: governor, arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  await denied(prepare);
  console.log('PASS: real old-module upgrade, held author drain, exact retry/conflict, denied reads/sends/replay/rekey, survivor history and post-upgrade denial. Local messaging only; no global completion or activation.');
} finally {
  await pic?.tearDown(); await server.stop();
}