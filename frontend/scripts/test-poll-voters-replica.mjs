import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';

assert.ok(process.env.MESSAGING_DOMAIN_WASM, 'MESSAGING_DOMAIN_WASM required');
const principal = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const owner = principal(1), member = principal(2), stranger = principal(3);
const ok = reply => { assert.ok('Ok' in reply, String(reply.Err)); return reply.Ok; };
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const chat = await pic.setupCanister({
    idlFactory, wasm: process.env.MESSAGING_DOMAIN_WASM,
    sender: owner, controllers: [owner], arg: IDL.encode([IDL.Principal], [owner]),
  });
  chat.actor.setPrincipal(owner);
  const conversation = ok(await chat.actor.create_conversation('dm', [], [owner, member]));
  const poll = ok(await chat.actor.create_poll(conversation.id, [], 'Training day?', ['Saturday', 'Sunday']));
  ok(await chat.actor.vote_poll(poll.id, 0));
  chat.actor.setPrincipal(member);
  ok(await chat.actor.vote_poll(poll.id, 1));
  for (const method of ['get_poll_results', 'read_account_get_poll_results']) {
    const results = ok(await chat.actor[method](poll.id));
    assert.deepEqual(Array.from(results.counts), [1, 1]);
    assert.equal(results.votes[0].find(v => v.user.toText() === owner.toText()).option_index, 0);
    assert.equal(results.votes[0].find(v => v.user.toText() === member.toText()).option_index, 1);
  }
  ok(await chat.actor.vote_poll(poll.id, 0));
  const changed = ok(await chat.actor.read_account_get_poll_results(poll.id));
  assert.deepEqual(Array.from(changed.counts), [2, 0]);
  assert.equal(changed.votes[0].filter(v => v.user.toText() === member.toText()).length, 1);
  chat.actor.setPrincipal(stranger);
  for (const method of ['get_poll_results', 'read_account_get_poll_results']) {
    let denied = false;
    try { denied = 'Err' in await chat.actor[method](poll.id); } catch { denied = true; }
    assert.ok(denied, 'Nonparticipant must not read voter identities');
  }
  console.log('Poll voter access, option mapping and replacement passed on a real local canister');
} finally {
  await pic?.tearDown();
  await server.stop();
}