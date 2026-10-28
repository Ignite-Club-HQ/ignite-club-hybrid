import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
assert.ok(process.env.MESSAGING_DOMAIN_WASM);
const owner = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const member = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const stranger = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const ok = result => { assert.ok('Ok' in result, result.Err); return result.Ok; };
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const chat = await pic.setupCanister({ idlFactory, wasm: process.env.MESSAGING_DOMAIN_WASM, sender: owner, controllers: [owner], arg: IDL.encode([IDL.Principal], [owner]) });
  chat.actor.setPrincipal(owner);
  const conversation = ok(await chat.actor.get_or_create_dm(member));
  assert.deepEqual(ok(await chat.actor.get_direct_conversation(conversation.id)).participants.map(p => p.toText()).sort(), [owner.toText(), member.toText()].sort());
  const sent = [];
  for (let i = 0; i < 50; i++) sent.push(ok(await chat.actor.send_message(conversation.id, `Message ${i}`, `send-${i}`, [], [])));
  const window = ok(await chat.actor.get_message_window(conversation.id, sent[15].id));
  assert.equal(window.messages.length, 37);
  assert.ok(window.messages.some(m => m.id === sent[15].id));
  assert.ok('Err' in await chat.actor.get_message_window('wrong-group', sent[15].id));
  const visiblePoll = ok(await chat.actor.create_poll(conversation.id, [], 'Choose a day', ['Saturday', 'Sunday']));
  ok(await chat.actor.vote_poll(visiblePoll.id, 0));
  ok(await chat.actor.send_message(conversation.id, `[poll:${visiblePoll.id}]`, 'poll-message', [], []));
  ok(await chat.actor.create_poll(conversation.id, [], 'Unreferenced poll', ['Yes', 'No']));
  const expectedPolls = [ok(await chat.actor.get_poll_results(visiblePoll.id))];
  for (const method of ['open_conversation', 'read_account_open_conversation']) {
    const bundle = ok(await chat.actor[method](conversation.id, 100));
    assert.deepEqual(bundle.polls, expectedPolls, `${method} preserves the referenced poll and its votes`);
  }
  // Six is the existing bundle bound; both twins must enforce it identically.
  for (let i = 0; i < 7; i++) {
    const poll = ok(await chat.actor.create_poll(conversation.id, [], `Poll ${i}`, ['Yes', 'No']));
    ok(await chat.actor.send_message(conversation.id, `[poll:${poll.id}]`, `extra-poll-${i}`, [], []));
  }
  const legacyBundle = ok(await chat.actor.open_conversation(conversation.id, 100));
  const protectedBundle = ok(await chat.actor.read_account_open_conversation(conversation.id, 100));
  assert.equal(protectedBundle.polls.length, 6);
  assert.deepEqual(protectedBundle.polls, legacyBundle.polls);
  assert.ok('Err' in await chat.actor.read_account_open_conversation(conversation.id, 0));
  assert.ok('Err' in await chat.actor.read_account_open_conversation(conversation.id, 101));
  chat.actor.setPrincipal(member);
  ok(await chat.actor.presence_heartbeat([]));
  chat.actor.setPrincipal(owner);
  assert.deepEqual(ok(await chat.actor.list_conversation_online_users(conversation.id)).map(p => p.toText()), [member.toText()]);
  chat.actor.setPrincipal(stranger);
  for (const [method, args] of [['get_direct_conversation', [conversation.id]], ['get_message_window', [conversation.id, sent[15].id]], ['list_conversation_online_users', [conversation.id]], ['open_conversation', [conversation.id, 100]], ['read_account_open_conversation', [conversation.id, 100]]]) {
    let denied = false;
    try { denied = 'Err' in await chat.actor[method](...args); } catch { denied = true; }
    assert.ok(denied, `${method} must deny nonparticipants`);
  }
  console.log('Private DM identity, exact old-message window and participant-only online readback passed');
} finally { await pic?.tearDown(); await server.stop(); }