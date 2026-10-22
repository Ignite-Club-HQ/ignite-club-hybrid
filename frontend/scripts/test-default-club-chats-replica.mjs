// Disposable real-canister proof. Never invokes mainnet or a production identity.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
for (const key of ['MESSAGING_DOMAIN_WASM', 'MESSAGING_BEFORE_WASM', 'POCKET_IC_BIN']) assert.ok(process.env[key], `${key} required`);
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const stranger = Principal.fromUint8Array(new Uint8Array([2, 1]));
const ok = r => { assert.ok('Ok' in r, r.Err); return r.Ok; };
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  for (const club of ['g1-club', 'g2-club']) {
    const chat = await pic.setupCanister({ idlFactory, wasm: process.env.MESSAGING_BEFORE_WASM, sender: governor,
      controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
    chat.actor.setPrincipal(governor);
    const entries = [[governor, 'owner']];
    const legacy = ok(await chat.actor.create_group_with_roles(club, [], 'Coaches', 'group', entries));
    const original = ok(await chat.actor.send_message(legacy.conversation_id, 'preserve history', 'before', [], []));
    await pic.upgradeCanister({ canisterId: chat.canisterId, wasm: process.env.MESSAGING_DOMAIN_WASM,
      sender: governor, arg: IDL.encode([IDL.Principal], [governor]),
      upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    const adopted = ok(await chat.actor.ensure_default_club_chat(club, 'coaches', [legacy.conversation_id], entries));
    assert.equal(adopted.conversation_id, legacy.conversation_id);
    assert.equal(ok(await chat.actor.list_messages_page(legacy.conversation_id, [], 10)).messages[0].id, original.id);
    // Ordinary/custom same-name creation remains distinct and keeps its history.
    const custom = ok(await chat.actor.create_group_with_roles(club, [], 'Coaches', 'group', entries));
    assert.notEqual(custom.conversation_id, legacy.conversation_id);
    assert.equal(ok(await chat.actor.ensure_default_club_chat(club, 'coaches', [custom.conversation_id], entries)).conversation_id, legacy.conversation_id);
    // Submit real overlapping ingress calls BEFORE awaiting any reply.
    const signature = idlFactory({ IDL })._fields.find(([name]) => name === 'ensure_default_club_chat')?.[1];
    assert.ok(signature);
    const pending = await Promise.all(Array.from({ length: 8 }, () => pic.client.submitCall({
      canisterId: chat.canisterId, sender: governor, method: 'ensure_default_club_chat',
      payload: new Uint8Array(IDL.encode(signature.argTypes, [club, 'team_admins', [], entries])),
    })));
    const replies = await Promise.all(pending.map(async request => {
      const reply = await pic.client.awaitCall(request);
      return ok(IDL.decode(signature.retTypes, reply.body)[0]);
    }));
    assert.equal(new Set(replies.map(r => r.conversation_id)).size, 1);
    assert.equal(ok(await chat.actor.list_groups_by_club(club)).filter(g => g.name === 'Team Admins').length, 1);
    assert.ok('Err' in await chat.actor.ensure_default_club_chat(club, 'unknown', [], entries));
    assert.ok('Err' in await chat.actor.ensure_default_club_chat('foreign', 'coaches', [custom.conversation_id], entries));
    // A return never applies the proposed owner/member rows.
    const beforeMembers = adopted.members.map(p => p.toText());
    const reused = ok(await chat.actor.ensure_default_club_chat(club, 'coaches', [], [...entries, [stranger, 'owner']]));
    assert.deepEqual(reused.members.map(p => p.toText()), beforeMembers);
    chat.actor.setPrincipal(stranger);
    await assert.rejects(() => chat.actor.ensure_default_club_chat(club, 'coaches', [], [[stranger, 'owner']]));
    chat.actor.setPrincipal(governor);
    ok(await chat.actor.soft_delete_group(legacy.conversation_id));
    assert.ok('Err' in await chat.actor.ensure_default_club_chat(club, 'coaches', [], entries));
    ok(await chat.actor.restore_group(legacy.conversation_id));
    await pic.upgradeCanister({ canisterId: chat.canisterId, wasm: process.env.MESSAGING_DOMAIN_WASM,
      sender: governor, arg: IDL.encode([IDL.Principal], [governor]),
      upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    assert.equal(ok(await chat.actor.ensure_default_club_chat(club, 'coaches', [], entries)).conversation_id, legacy.conversation_id);
    assert.equal(ok(await chat.actor.list_messages_page(legacy.conversation_id, [], 10)).messages[0].id, original.id);
  }
  console.log('PASS: both disposable groups; eight overlapping calls produce one standard chat; legacy history, distinct custom chat, stable binding, denied caller/scope and explicit deletion/restore survive upgrades.');
} finally { await pic?.tearDown(); await server.stop(); }