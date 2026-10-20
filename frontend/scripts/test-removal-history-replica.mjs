// Local recovery evidence only; no import/restore, global drain or deployment.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
const wasm = process.env.IDENTITY_ACCESS_WASM;
if (!wasm) throw new Error('IDENTITY_ACCESS_WASM required');
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), erasedUser = p(2), old = p(3), replacement = p(4), stranger = p(5);
const ok = r => { assert.ok('Ok' in r, 'Expected successful history reply'); return r.Ok; };
const denied = r => assert.ok('Err' in r, 'Expected denied history reply');
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const arg = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]);
  const setup = async local => pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], arg,
    environmentVariables: local ? [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }] : [] });
  const production = await setup(false);
  production.actor.setPrincipal(governor);
  denied(await production.actor.read_removal_history_manifest());
  denied(await production.actor.read_removal_history_page(0n, { Done: null }, 1));
  const { actor, canisterId } = await setup(true);
  actor.setPrincipal(erasedUser); const erased = ok(await actor.register_account());
  ok(await actor.erase_account(erased.id));
  actor.setPrincipal(old); const moved = ok(await actor.register_account());
  actor.setPrincipal(governor); ok(await actor.rekey_principal(old, replacement, false));
  const snapshot = ok(await actor.read_removal_history_manifest());
  ok(await actor.set_service_authorities([p(10)]));
  denied(await actor.read_removal_history_page(snapshot.revision, { PrincipalDenials: [] }, 1));
  const afterReaders = ok(await actor.read_removal_history_manifest());
  ok(await actor.set_club_authorities([p(11)]));
  denied(await actor.read_removal_history_page(afterReaders.revision, { Done: null }, 1));
  actor.setPrincipal(p(6)); const unlinkAccount = ok(await actor.register_account());
  const challenge = ok(await actor.begin_link(p(7)));
  actor.setPrincipal(p(7)); ok(await actor.accept_link(challenge.id));
  actor.setPrincipal(governor); const beforeUnlink = ok(await actor.read_removal_history_manifest());
  actor.setPrincipal(p(6)); denied(await actor.revoke(p(7), 1n));
  actor.setPrincipal(governor);
  denied(await actor.read_removal_history_page(beforeUnlink.revision, { Done: null }, 1));
  actor.setPrincipal(stranger); denied(await actor.read_removal_history_manifest());
  denied(await actor.read_removal_history_page(0n, { Done: null }, 1));
  actor.setPrincipal(Principal.anonymous()); denied(await actor.read_removal_history_manifest());
  actor.setPrincipal(governor);
  async function exportHistory() {
    const manifest = ok(await actor.read_removal_history_manifest());
    let cursor = { PrincipalDenials: [] }; const rows = { denials: [], erased: [], pending: [] };
    for (let i = 0; i < 30; i++) {
      const page = ok(await actor.read_removal_history_page(manifest.revision, cursor, 1));
      assert.ok(page.denials.length + page.erased.length + page.pending.length <= 1);
      for (const key of Object.keys(rows)) rows[key].push(...page[key]);
      cursor = page.next;
      if ('Done' in cursor) break;
    }
    assert.ok('Done' in cursor, 'Whole history must reach terminal cursor');
    assert.equal(BigInt(rows.denials.length), manifest.principal_denials);
    assert.equal(BigInt(rows.erased.length), manifest.erased_accounts);
    assert.equal(BigInt(rows.pending.length), manifest.pending_intents);
    assert.equal(ok(await actor.read_removal_history_manifest()).revision, manifest.revision);
    return { manifest, rows };
  }
  const before = await exportHistory();
  const rekey = before.rows.denials.find(([subject]) => subject === old.toText())[1];
  assert.ok('Rekeyed' in rekey.reason); assert.equal(rekey.rekey_destination[0].toText(), replacement.toText());
  assert.equal(rekey.account_id, moved.id);
  assert.ok('Erased' in before.rows.denials.find(([subject]) => subject === erasedUser.toText())[1].reason);
  assert.equal(before.rows.erased[0][0], erased.id);
  assert.equal(before.manifest.service_readers[0].toText(), p(10).toText());
  assert.equal(before.manifest.club_authorities[0].toText(), p(11).toText());
  assert.equal(before.manifest.pending_intents, 1n);
  assert.equal(before.rows.pending[0].account_id, unlinkAccount.id);
  assert.equal(before.rows.pending[0].principal.toText(), p(7).toText());
  assert.equal(before.rows.pending[0].version, 1n);
  assert.deepEqual(before.rows.pending[0].authorities.map(p => p.toText()), [p(11).toText()]);
  assert.deepEqual(before.rows.pending[0].acknowledged, []);
  for (const limit of [0, 201]) denied(await actor.read_removal_history_page(before.manifest.revision, { Done: null }, limit));
  await pic.upgradeCanister({ canisterId, wasm, sender: governor, arg });
  denied(await actor.read_removal_history_page(before.manifest.revision, { Done: null }, 1));
  const after = await exportHistory();
  assert.deepEqual(after.rows, before.rows);
  assert.deepEqual(after.manifest.service_readers, before.manifest.service_readers);
  assert.deepEqual(after.manifest.club_authorities, before.manifest.club_authorities);
  for (const subject of [old, erasedUser]) { actor.setPrincipal(subject); denied(await actor.register_account()); }
  actor.setPrincipal(replacement); assert.equal(ok(await actor.whoami()).id, moved.id);
  actor.setPrincipal(p(7)); denied(await actor.register_account());
  console.log('PASS: bounded whole removal history, stale inventory/upgrade snapshots, governor privacy, real erase/rekey preservation; no restore/global drain claim.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }