// Deletion proof on disposable canisters only: no production identity, ID or credential.
// Seeds one throwaway person across sign-in, club, events and chat services, runs the
// same self-deletion calls the app makes, then scans every service's full governor
// export for any trace of that person. Shared records owned by others are expected.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as chatIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';

for (const key of ['POCKET_IC_BIN', 'IDENTITY_ACCESS_WASM', 'CLUB_DOMAIN_WASM', 'EVENTS_DOMAIN_WASM', 'MESSAGING_DOMAIN_WASM'])
  assert.ok(process.env[key], `${key} required; never silently skip this proof`);
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 7, 7]));
const governor = p(1), person = p(2), friend = p(3);
const ok = r => { assert.ok(r && 'Ok' in r, String(r?.Err ?? Object.keys(r ?? {}))); return r.Ok; };
const text = v => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString()
  : x && typeof x === 'object' && typeof x.toText === 'function' && x._isPrincipal ? x.toText() : x);
const steps = [];
const traces = (label, dump, needles) => {
  const s = text(dump), found = needles.filter(n => s.includes(n));
  steps.push({ service: label, passed: found.length === 0, remaining: found.length });
  return found;
};

const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN });
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const motoko = (idlFactory, wasm) => pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.IDENTITY_ACCESS_WASM, sender: governor, controllers: [governor],
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  const club = await motoko(clubIdl, process.env.CLUB_DOMAIN_WASM);
  const events = await motoko(eventsIdl, process.env.EVENTS_DOMAIN_WASM);
  const chat = await motoko(chatIdl, process.env.MESSAGING_DOMAIN_WASM);
  const as = (c, who) => { c.actor.setPrincipal(who); return c.actor; };

  // Seed: account, club membership, calendar preference, chat thread + message + read state.
  ok(await as(identity, governor).register_account());
  const account = ok(await as(identity, person).register_account());
  ok(await as(club, governor).create_club('proof-club', 'Proof club', 'proof-club', [], []));
  ok(await as(club, governor).add_role_grant(person, 'proof-club', 'player', []));
  ok(await as(club, governor).add_role_grant(friend, 'proof-club', 'player', []));
  ok(await as(events, person).set_schedule_view('calendar'));
  const dm = ok(await as(chat, person).get_or_create_dm(friend));
  ok(await as(chat, person).send_message(dm.id, 'Throwaway message', 'proof-1', [], []));
  ok(await as(chat, friend).send_message(dm.id, 'Reply kept for friend', 'proof-2', [], []));

  const needles = [person.toText(), account.id];
  const dumps = async () => ({
    identity: ok(await as(identity, governor).export_state()),
    club: ok(await as(club, governor).export_acl()),
    events: { state: ok(await as(events, governor).export_state()), view: await as(events, person).get_schedule_view().catch(() => []) },
    chat: ok(await as(chat, governor).export_state()),
  });
  const before = await dumps();
  for (const k of Object.keys(before)) assert.ok(text(before[k]).includes(person.toText()) || text(before[k]).includes(account.id) || k === 'events' && before.events.view.length,
    `${k}: seed must store the person before deletion`);

  // Same order as the app's self-deletion: revoke club access, purge content, erase sign-in.
  ok(await as(club, person).erase_my_membership());
  ok(await as(events, person).purge_my_data());
  ok(await as(chat, person).purge_my_data());
  ok(await as(identity, person).erase_account(account.id));

  const after = await dumps();
  const leftovers = {
    identity: traces('Sign-in and profile', after.identity, needles),
    club: traces('Club and team access', after.club, needles),
    events: traces('Events and calendar settings', after.events, needles),
    chat: traces('Chats and messages', after.chat, needles),
  };
  // Friend keeps their own reply; the thread is not deleted from under them.
  assert.ok(text(after.chat).includes('Reply kept for friend'), 'other member content must remain');
  writeFileSync(process.env.DELETION_PROOF_REPORT ?? '/tmp/deletion-proof-report.json', JSON.stringify({ productionChanged: false, steps, leftovers }, null, 2));
  for (const [k, found] of Object.entries(leftovers)) assert.deepEqual(found, [], `${k} still holds the deleted person`);
  console.log('PASS: deleted person absent from sign-in, club, events and chat services; other members\' content retained');
} finally { await pic?.tearDown(); await server.stop(); }
