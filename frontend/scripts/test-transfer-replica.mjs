// Isolated practice move between two local groups (never mainnet). Each group
// has real club_domain, events_domain, messaging_domain and vault_domain
// canisters; the production runner + live adapter move one club across.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as vaultIdl } from '../src/lab/bindings/vault_domain/declarations/vault_domain.did.js';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as chatIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { planTransfer } from '../src/live/groupTransfer.ts';
import { runTransfer } from '../src/live/groupTransferRunner.ts';
import { liveTransferAdapter } from '../src/live/groupTransferLiveAdapter.ts';

const root = resolve(import.meta.dirname, '../..');
const wasm = c => process.env[`${c.toUpperCase()}_WASM`] ?? resolve(root, `backend/${c}/.mops/.build/${c}.wasm`);
const idls = { club_domain: clubIdl, events_domain: eventsIdl, messaging_domain: chatIdl, vault_domain: vaultIdl };
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const staff = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const ok = r => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const CLUB = 'club-move';
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const groups = {};
  for (const g of ['a', 'b']) {
    groups[g] = {};
    for (const c of Object.keys(idls)) {
      const f = await pic.setupCanister({ idlFactory: idls[c], wasm: wasm(c), sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
      f.actor.setPrincipal(governor); groups[g][c] = f.actor;
    }
  }
  const A = groups.a, B = groups.b;
  const refused = p => p.catch(e => ({ Err: String(e.message) }));
  const as = (actor, p, fn) => { actor.setPrincipal(p); return fn().finally(() => actor.setPrincipal(governor)); };

  // Seed the club on group A across all four domains, plus a bystander club on B.
  ok(await A.club_domain.create_club(CLUB, 'Move FC', CLUB, [], []));
  ok(await A.club_domain.add_role_grant(staff, CLUB, 'club_admin', []));
  ok(await B.club_domain.create_club('other-club', 'Other FC', 'other-club', [], []));
  const ev = ok(await A.events_domain.create_event(CLUB, [], 'Training', 'Tuesday session', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  ok(await B.events_domain.create_event('other-club', [], 'Other', 'Stays put', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  const conv = ok(await A.messaging_domain.create_conversation(CLUB, [], [governor]));
  for (let i = 0; i < 3; i++) ok(await A.messaging_domain.send_message(conv.id, `hello ${i}`, `k${i}`, [], []));
  ok(await A.vault_domain.grant_role(staff, 'club_admin', [CLUB], []));
  ok(await B.vault_domain.grant_role(staff, 'club_admin', [CLUB], []));
  ok(await as(A.vault_domain, staff, () => A.vault_domain.create_folder('f1', CLUB, [], [], 'Docs', [], [], [], 0, [], [])));
  ok(await as(A.vault_domain, staff, () => A.vault_domain.register_file('file1', 'f1', CLUB, [], 'rules.pdf', 'https://x/rules', 10n, 'application/pdf', false, [], [], [])));

  let registryRev = 1n; let assignment = 'a'; const blocked = {}; const saved = [];
  const base = liveTransferAdapter({
    actors: g => groups[g], fenceRevision: 1n,
    assertDomainEmpty: async () => {}, // other nine domains hold no data in this rehearsal
    sameDeployment: async () => true,
    readRegistryRevision: async () => registryRev,
    swapAssignment: async (club, to, expected) => { assert.equal(expected, registryRev); assignment = to; registryRev += 1n; },
    save: async t => { saved.push(t.phase); },
  });
  const adapter = { ...base, setFence: async (g, club, on) => {
    await base.setFence(g, club, on);
    if (on && g === 'a') { // writes in every domain must be refused while moving
      blocked.event = await refused(A.events_domain.create_event(CLUB, [], 'Sneaky', 'x', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
      blocked.chat = await refused(A.messaging_domain.send_message(conv.id, 'sneaky', 'k-sneak', [], []));
      blocked.vault = await refused(as(A.vault_domain, staff, () => A.vault_domain.rename_file('file1', 'hacked.pdf')));
      blocked.club = await refused(as(A.club_domain, staff, () => A.club_domain.add_role_grant(governor, CLUB, 'coach', [])));
    }
  } };

  const done = await runTransfer(planTransfer(CLUB, 'a', 'b', 1n), adapter);
  assert.equal(done.phase, 'released'); assert.equal(assignment, 'b');
  assert.deepEqual(saved, ['fenced', 'copied', 'verified', 'cutover', 'released']);
  for (const [k, r] of Object.entries(blocked)) assert.ok('Err' in r, `${k} write must be refused while fenced`);

  // Target now serves the club in every domain; bystander club untouched.
  assert.equal(ok(await B.club_domain.get_club_profile(CLUB))[0]?.name, 'Move FC');
  assert.equal(ok(await B.club_domain.get_club_profile('other-club'))[0]?.name, 'Other FC');
  assert.deepEqual((await B.events_domain.list_events([CLUB], [])).map(e => e.id), [ev.id]);
  assert.equal((await B.events_domain.list_events(['other-club'], [])).length, 1);
  assert.deepEqual((await B.messaging_domain.list_messages(conv.id, [])).map(m => m.body), ['hello 0', 'hello 1', 'hello 2']);
  assert.deepEqual(ok(await as(B.vault_domain, staff, () => B.vault_domain.list_files('f1'))).map(f => f.name), ['rules.pdf']);
  // Writable again on the target; source holds nothing.
  ok(await B.messaging_domain.send_message(conv.id, 'after move', 'k-after', [], []));
  ok(await as(B.vault_domain, staff, () => B.vault_domain.rename_file('file1', 'rules-v2.pdf')));
  ok(await B.events_domain.create_event(CLUB, [], 'Match', 'Saturday', 'match', [], [], [], [], 3_000n, 4_000n, [], false, [], []));
  assert.equal(ok(await A.club_domain.get_club_profile(CLUB)).length, 0);
  assert.equal((await A.events_domain.list_events([CLUB], [])).length, 0);
  assert.equal(ok(await as(A.vault_domain, staff, () => A.vault_domain.list_files('f1'))).length, 0);

  // Aborted move: tampering after copy discards the target copy and unlocks the source.
  const t2 = 'club-abort';
  ok(await A.events_domain.create_event(t2, [], 'Keep', 'here', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  const tamper = { ...base, digest: async (g, club, dom) => {
    const d = await base.digest(g, club, dom); return g === 'b' && dom === 'events_domain' ? { ...d, digest: 'tampered' } : d;
  } };
  const aborted = await runTransfer(planTransfer(t2, 'a', 'b', registryRev), tamper).catch(e => e);
  assert.ok(aborted instanceof Error || aborted.phase === 'aborted', 'mismatched copy must abort');
  assert.equal((await A.events_domain.list_events([t2], [])).length, 1);
  assert.equal((await B.events_domain.list_events([t2], [])).length, 0);
  ok(await A.events_domain.create_event(t2, [], 'Unlocked', 'yes', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  // Non-governors cannot lock or export.
  assert.ok('Err' in await as(B.events_domain, staff, () => B.events_domain.set_transfer_fence(CLUB, true)));
  assert.ok('Err' in await as(B.messaging_domain, staff, () => B.messaging_domain.export_club_snapshot_page(CLUB, 0n, 10n)));
  console.log('practice move passed: club details, events, chat and vault moved with locks, verification, cutover, purge and abort');
} finally { await pic?.tearDown(); await server.stop(); }
