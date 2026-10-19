// Local consensus authority rehearsal; no deployment or routing activation.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const primary = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const linked = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const stranger = Principal.fromUint8Array(Uint8Array.from([4, 1]));
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.IDENTITY_ACCESS_WASM,
    sender: governor, controllers: [governor], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  const groups = [];
  for (const suffix of ['a', 'b']) {
    const group = await pic.setupCanister({ idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM,
      sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
    group.actor.setPrincipal(governor);
    ok(await group.actor.create_club(`club-${suffix}`, suffix, suffix, [], []));
    ok(await group.actor.add_role_grant(primary, `club-${suffix}`, 'player', []));
    ok(await group.actor.add_role_grant(linked, `club-${suffix}`, 'coach', []));
    ok(await group.actor.set_identity_access_canister(identity.canisterId));
    groups.push(group);
  }
  const service = identity.actor; service.setPrincipal(governor);
  ok(await service.set_club_authorities(groups.map(g => g.canisterId)));
  assert.ok('Err' in await service.set_club_authorities([groups[0].canisterId]));
  service.setPrincipal(primary); const account = ok(await service.register_account());
  const challenge = ok(await service.begin_link(linked));
  service.setPrincipal(linked); const joined = ok(await service.accept_link(challenge.id));
  assert.equal(joined.version, 1n);
  for (const group of groups) {
    group.actor.setPrincipal(linked); ok(await group.actor.sync_my_linked_account());
    assert.equal(ok(await group.actor.whoami()).id, account.id);
    assert.equal(ok(await group.actor.read_my_club_memberships_indexed([], 100)).clubs.length, 1);
    group.actor.setPrincipal(stranger); assert.ok('Err' in await group.actor.revoke_linked_principal(account.id, linked, 1n));
  }
  service.setPrincipal(stranger); assert.ok('Err' in await service.read_linked_account(primary));
  service.setPrincipal(primary);
  await pic.stopCanister({ canisterId: groups[1].canisterId, sender: governor });
  assert.ok('Err' in await service.revoke(linked, 1n));
  service.setPrincipal(linked); assert.ok('Err' in await service.whoami());
  service.setPrincipal(governor); assert.ok('Err' in await service.set_club_authorities(groups.map(g => g.canisterId)));
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: process.env.IDENTITY_ACCESS_WASM, sender: governor,
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  await pic.startCanister({ canisterId: groups[1].canisterId, sender: governor });
  service.setPrincipal(primary); const revoked = ok(await service.revoke(linked, 1n));
  assert.equal(revoked.version, 2n); assert.deepEqual(revoked.principals.map(p => p.toText()), [primary.toText()]);
  for (const [index, group] of groups.entries()) {
    group.actor.setPrincipal(linked);
    assert.ok('Err' in await group.actor.sync_my_linked_account());
    assert.deepEqual(await group.actor.my_role_grants(), []);
    assert.deepEqual(ok(await group.actor.read_my_club_memberships_indexed([], 100)).clubs, []);
    group.actor.setPrincipal(primary); ok(await group.actor.sync_my_linked_account());
    assert.deepEqual(ok(await group.actor.read_my_club_memberships_indexed([], 100)).clubs, [`club-${index ? 'b' : 'a'}`]);
  }
  // Re-link and then replay the old removal. Receiver tombstones prevent a
  // delayed acknowledgement from destructively executing a second time.
  service.setPrincipal(primary); const next = ok(await service.begin_link(linked));
  service.setPrincipal(linked); ok(await service.accept_link(next.id));
  for (const group of groups) {
    group.actor.setPrincipal(governor); ok(await group.actor.add_role_grant(linked, group === groups[0] ? 'club-a' : 'club-b', 'coach', []));
    group.actor.setPrincipal(identity.canisterId); ok(await group.actor.revoke_linked_principal(account.id, linked, 1n));
    group.actor.setPrincipal(linked); ok(await group.actor.sync_my_linked_account());
    assert.equal((await group.actor.my_role_grants()).length, 1);
    assert.equal(ok(await group.actor.read_my_club_memberships_indexed([], 100)).clubs.length, 1);
  }
  console.log('PASS: two-group authoritative link sync, private authority denial, unavailable group, durable upgrade/retry, revoked membership, survivor preservation, re-link and old-operation replay.');
} finally { await pic?.tearDown(); await server.stop(); }