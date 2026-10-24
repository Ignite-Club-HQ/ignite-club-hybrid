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
  chat.actor.setPrincipal(member);
  ok(await chat.actor.presence_heartbeat([]));
  chat.actor.setPrincipal(owner);
  assert.deepEqual(ok(await chat.actor.list_conversation_online_users(conversation.id)).map(p => p.toText()), [member.toText()]);
  chat.actor.setPrincipal(stranger);
  for (const [method, args] of [['get_direct_conversation', [conversation.id]], ['get_message_window', [conversation.id, sent[15].id]], ['list_conversation_online_users', [conversation.id]]]) {
    let denied = false;
    try { denied = 'Err' in await chat.actor[method](...args); } catch { denied = true; }
    assert.ok(denied, `${method} must deny nonparticipants`);
  }
  console.log('Private DM identity, exact old-message window and participant-only online readback passed');
} finally { await pic?.tearDown(); await server.stop(); }