// Isolated vault transfer rehearsal between two real vault canisters (never mainnet).
// Drives the production runner (groupTransferRunner) end-to-end for the vault
// domain; the other 12 domains are empty in this rehearsal.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/vault_domain/declarations/vault_domain.did.js';
import { planTransfer } from '../src/live/groupTransfer.ts';
import { runTransfer } from '../src/live/groupTransferRunner.ts';

const wasm = process.env.VAULT_WASM ?? '/tmp/w/vault_domain.wasm';
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const staff = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const ok = r => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const CLUB = 'club-move';
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const groups = {};
  for (const g of ['a', 'b']) {
    const f = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
    f.actor.setPrincipal(governor); groups[g] = f.actor;
  }
  const A = groups.a, B = groups.b;
  ok(await A.grant_role(staff, 'club_admin', [CLUB], []));
  ok(await B.grant_role(staff, 'club_admin', [CLUB], []));
  // Other club on B must survive and must not be overwritten by the import.
  ok(await B.create_folder('other-f', 'other-club', [], [], 'Other', [], [], [], 0, [], []));
  A.setPrincipal(staff);
  ok(await A.create_folder('f1', CLUB, [], [], 'Docs', [], [], [], 0, [], []));
  ok(await A.register_file('file1', 'f1', CLUB, [], 'rules.pdf', 'https://x/rules', 10n, 'application/pdf', false, [], [], []));
  ok(await A.register_file('file2', 'f1', CLUB, [], 'kit.pdf', 'https://x/kit', 20n, 'application/pdf', false, [], [], []));
  A.setPrincipal(governor);

  const snapshotOf = async (actor, club) => {
    const r = await actor.export_club_snapshot(club);
    return 'Err' in r ? null : new Uint8Array(r.Ok);
  };
  const fenced = new Set(); let blockedWrite = null; let registryRev = 1n; let assignment = 'a';
  const actorFor = g => groups[g];
  const adapter = {
    sameDeployment: async () => true,
    setFence: async (g, club, on) => {
      ok(await actorFor(g).set_transfer_fence(club, on)); on ? fenced.add(g) : fenced.delete(g);
      ok(await actorFor(g === 'a' ? 'b' : 'a').set_transfer_fence(club, on)); // target fenced while importing
      if (on && g === 'a') {
        A.setPrincipal(staff);
        blockedWrite = await A.rename_file('file1', 'hacked.pdf');
        A.setPrincipal(governor);
      }
    },
    exportPage: async (g, club, domain) => domain === 'vault_domain' ? { rows: [await snapshotOf(actorFor(g), club)], next: null } : { rows: [], next: null },
    importPage: async (g, club, domain, rows) => { if (domain === 'vault_domain') ok(await actorFor(g).import_club_snapshot(club, rows[0])); },
    digest: async (g, club, domain) => {
      if (domain !== 'vault_domain') return { domain, records: 0, digest: 'empty' };
      const snap = await snapshotOf(actorFor(g), club);
      return { domain, records: snap.length, digest: createHash('sha256').update(snap).digest('hex') };
    },
    readRegistryRevision: async () => registryRev,
    swapAssignment: async (club, to, expected) => { assert.equal(expected, registryRev); assignment = to; registryRev += 1n; },
    purgeSource: async (g, club) => { ok(await actorFor(g).purge_club_snapshot(club)); },
    save: async () => {},
  };
  const done = await runTransfer(planTransfer(CLUB, 'a', 'b', 1n), adapter);
  assert.equal(done.phase, 'released'); assert.equal(assignment, 'b');
  assert.ok('Err' in blockedWrite && /locked for a transfer/.test(blockedWrite.Err), 'staff write must be refused while fenced');
  // Target holds the club; other club untouched; source purged.
  ok(await B.set_transfer_fence(CLUB, false)); ok(await A.set_transfer_fence(CLUB, false));
  B.setPrincipal(staff);
  const files = ok(await B.list_files('f1')).map(f => f.name).sort();
  assert.deepEqual(files, ['kit.pdf', 'rules.pdf']);
  ok(await B.rename_file('file1', 'rules-v2.pdf')); // writable again after cutover
  A.setPrincipal(staff);
  assert.equal(ok(await A.list_files('f1')).length, 0);
  // Foreign/colliding imports are rejected.
  B.setPrincipal(governor); ok(await B.set_transfer_fence('other-club', true));
  const foreign = await B.export_club_snapshot('other-club');
  assert.ok('Err' in await B.import_club_snapshot(CLUB, foreign.Ok), 'foreign snapshot must be rejected');
  assert.ok('Err' in await B.import_club_snapshot('not-fenced', foreign.Ok));
  B.setPrincipal(staff); assert.ok('Err' in await B.set_transfer_fence(CLUB, true), 'non-governor cannot fence');
  console.log('transfer rehearsal passed: fence blocked writes, verified copy, CAS cutover, source purged, foreign import rejected');
} finally { await pic?.tearDown(); await server.stop(); }
