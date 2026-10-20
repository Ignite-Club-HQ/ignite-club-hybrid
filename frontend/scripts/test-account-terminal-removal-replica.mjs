// Identity-local acceptance only: no deployment, domain-wide revocation or routing activation.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';

const wasm = process.env.IDENTITY_ACCESS_WASM;
if (!wasm) throw new Error('IDENTITY_ACCESS_WASM is required');
const principal = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = principal(1), first = principal(2), second = principal(3);
const old = principal(4), replacement = principal(5), bystander = principal(6);
const ok = value => { assert.ok('Ok' in value, 'Expected successful canister response'); return value.Ok; };
const denied = value => assert.ok('Err' in value, 'Expected denied canister response');
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const args = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]);
  const identity = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], arg: args });
  const actor = identity.actor;
  actor.setPrincipal(bystander); const untouched = ok(await actor.register_account());
  actor.setPrincipal(first); const erased = ok(await actor.register_account());
  ok(await actor.set_profile('Local erased fixture', []));
  const invitation = ok(await actor.begin_link(second));
  actor.setPrincipal(second); ok(await actor.accept_link(invitation.id));
  actor.setPrincipal(bystander); denied(await actor.erase_account(erased.id));
  actor.setPrincipal(first); ok(await actor.erase_account(erased.id));
  for (const p of [first, second]) {
    actor.setPrincipal(p); denied(await actor.register_account()); denied(await actor.whoami());
    denied(await actor.set_profile('Must not recreate', []));
  }
  actor.setPrincipal(bystander); denied(await actor.begin_link(first));
  actor.setPrincipal(second); denied(await actor.accept_link(invitation.id));

  actor.setPrincipal(old); const moved = ok(await actor.register_account());
  ok(await actor.set_profile('Local surviving fixture', []));
  actor.setPrincipal(replacement); ok(await actor.register_account());
  actor.setPrincipal(governor); ok(await actor.register_account());
  assert.ok(ok(await actor.rekey_principal(old, replacement, true)) > 0n);
  actor.setPrincipal(old); assert.equal(ok(await actor.whoami()).id, moved.id);
  actor.setPrincipal(governor); ok(await actor.rekey_principal(old, replacement, false));
  assert.equal(ok(await actor.rekey_principal(old, replacement, false)), 0n);
  actor.setPrincipal(old); denied(await actor.register_account()); denied(await actor.whoami());
  actor.setPrincipal(replacement); assert.equal(ok(await actor.whoami()).id, moved.id);
  assert.equal(ok(await actor.get_profile()).display_name, 'Local surviving fixture');
  denied(await actor.begin_link(old));

  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm, sender: governor, arg: args });
  for (const p of [first, second, old]) {
    actor.setPrincipal(p); denied(await actor.register_account()); denied(await actor.whoami());
  }
  actor.setPrincipal(replacement); assert.equal(ok(await actor.whoami()).id, moved.id);
  actor.setPrincipal(bystander); assert.equal(ok(await actor.whoami()).id, untouched.id);
  actor.setPrincipal(governor);
  // Production prototype APIs remain closed even after the upgrade.
  denied(await actor.read_principal_eligibility(old));
  denied(await actor.read_removal_history_manifest());
  denied(await actor.read_removal_history_page(0n, { Done: null }, 1));
  denied(await actor.set_club_authorities([principal(7)]));
  denied(await actor.rekey_principal(first, replacement, true));
  denied(await actor.erase_account(ok(await actor.whoami()).id));
  console.log('PASS: identity-local erase/rekey blocks persist through real upgrade; replays denied, survivor/profile/bystander preserved, production gates closed. NOT all-domain revocation.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}