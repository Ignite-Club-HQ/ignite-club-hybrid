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
const denied = async call => {
  try { const result = await call(); assert.ok(result && 'Err' in result, 'Expected explicit denial'); }
  catch (error) {
    // Transport/test failures are not authorization evidence.
    assert.match(String(error), /Account admission denied or unavailable|Account removal fenced|Identity authority unavailable/);
  }
};
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.IDENTITY_ACCESS_WASM,
    sender: governor, controllers: [governor], environmentVariables: [{ name: "IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL", value: "1" }], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  const groups = [];
  const service = identity.actor; service.setPrincipal(governor);
  ok(await service.register_account());
  const productionGroup = await pic.setupCanister({ idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM,
    sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  productionGroup.actor.setPrincipal(governor);
  assert.ok('Err' in await productionGroup.actor.set_identity_access_canister(identity.canisterId), 'production authority setter stays closed');
  for (const suffix of ['a', 'b']) {
    const group = await pic.setupCanister({ idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM,
      sender: governor, controllers: [governor], environmentVariables: [
        { name: "IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL", value: "1" },
        { name: "IGNITE_ACCOUNT_SERVICE_IDENTITY", value: identity.canisterId.toText() }
      ], arg: IDL.encode([IDL.Principal], [governor]) });
    service.setPrincipal(governor);
    ok(await service.set_service_authorities([...groups, group].map(g => g.canisterId)));
    group.actor.setPrincipal(governor);
    ok(await group.actor.create_club(`club-${suffix}`, suffix, suffix, [], []));
    ok(await group.actor.add_role_grant(primary, `club-${suffix}`, 'player', []));
    ok(await group.actor.add_role_grant(linked, `club-${suffix}`, 'coach', []));
    ok(await group.actor.set_identity_access_canister(identity.canisterId));
    groups.push(group);
  }
  service.setPrincipal(governor);
  ok(await service.set_club_authorities(groups.map(g => g.canisterId)));
  assert.ok('Err' in await service.set_club_authorities([groups[0].canisterId]));
  service.setPrincipal(primary); const account = ok(await service.register_account());
  const challenge = ok(await service.begin_link(linked));
  service.setPrincipal(linked); const joined = ok(await service.accept_link(challenge.id));
  assert.equal(joined.version, 1n);
  for (const group of groups) {
    group.actor.setPrincipal(linked); ok(await group.actor.sync_my_linked_account());
    assert.equal(ok(await group.actor.read_account_whoami()).id, account.id);
    assert.equal(ok(await group.actor.read_my_club_memberships_indexed([], 100)).clubs.length, 1);
    group.actor.setPrincipal(stranger); assert.ok('Err' in await group.actor.revoke_linked_principal(account.id, linked, 1n));
  }
  service.setPrincipal(stranger); assert.ok('Err' in await service.read_linked_account(primary));
  assert.ok('Err' in await service.read_principal_eligibility(primary));
  service.setPrincipal(groups[0].canisterId);
  assert.ok('Eligible' in ok(await service.read_principal_eligibility(linked)).decision);
  assert.ok('Denied' in ok(await service.read_principal_eligibility(stranger)).decision);
  assert.ok('Err' in await service.read_principal_eligibilities([]));
  assert.ok('Err' in await service.read_principal_eligibilities([linked, linked]));
  assert.ok('Err' in await service.read_principal_eligibilities(Array(201).fill(linked)));
  // Stop the remote authority so sync cannot finish before local removal.
  // One tick alone does not establish an async pause on same-subnet actors.
  await pic.stopCanister({ canisterId: identity.canisterId, sender: governor });
  // Use submit/await directly: the SDK deferred actor loses rejected callbacks.
  const submit = async (factory, canisterId, sender, method, args) => {
    const signature = factory({ IDL })._fields.find(([name]) => name === method)?.[1];
    assert.ok(signature, 'Method must exist in the actual contract');
    const message = await pic.client.submitCall({ canisterId, sender, method,
      payload: new Uint8Array(IDL.encode(signature.argTypes, args)) });
    return async () => {
      const response = await pic.client.awaitCall(message);
      return IDL.decode(signature.retTypes, response.body)[0];
    };
  };
  const staleSync = await submit(clubIdl, groups[0].canisterId, linked, 'sync_my_linked_account', []);
  await pic.tick(1);
  groups[0].actor.setPrincipal(identity.canisterId);
  ok(await groups[0].actor.revoke_linked_principal(account.id, linked, 1n));
  await pic.startCanister({ canisterId: identity.canisterId, sender: governor });
  await denied(staleSync);
  groups[0].actor.setPrincipal(linked);
  assert.ok('Err' in await groups[0].actor.sync_my_linked_account(), 'old authority snapshot also fails when sync starts after the removal receipt');
  assert.deepEqual(await groups[0].actor.read_account_my_role_grants(), []);
  service.setPrincipal(primary);
  await pic.stopCanister({ canisterId: groups[1].canisterId, sender: governor });
  assert.ok('Err' in await service.revoke(linked, 1n));
  service.setPrincipal(linked); assert.ok('Err' in await service.whoami());
  assert.ok('Err' in await service.register_account(), 'pending denial blocks registration');
  service.setPrincipal(groups[0].canisterId);
  const pendingEligibility = ok(await service.read_principal_eligibility(linked));
  assert.ok('Denied' in pendingEligibility.decision);
  assert.equal(pendingEligibility.denied_through_version[0], 1n);
  service.setPrincipal(governor); assert.ok('Err' in await service.set_club_authorities(groups.map(g => g.canisterId)));
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: process.env.IDENTITY_ACCESS_WASM, sender: governor,
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  await pic.startCanister({ canisterId: groups[1].canisterId, sender: governor });
  // Before retrying fan-out, the unreached group's local grants still exist.
  // Current identity eligibility must deny the revoked alias immediately.
  groups[1].actor.setPrincipal(linked);
  await denied(() => groups[1].actor.read_account_my_role_grants());
  await denied(() => groups[1].actor.read_my_club_memberships_indexed([], 100));
  await denied(() => groups[1].actor.sync_my_linked_account());
  groups[1].actor.setPrincipal(primary);
  assert.deepEqual(ok(await groups[1].actor.read_my_club_memberships_indexed([], 100)).clubs, ['club-b']);
  await pic.upgradeCanister({ canisterId: groups[0].canisterId, wasm: process.env.CLUB_DOMAIN_WASM, sender: governor,
    arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  groups[0].actor.setPrincipal(linked);
  await denied(() => groups[0].actor.sync_my_linked_account());
  service.setPrincipal(primary); const revoked = ok(await service.revoke(linked, 1n));
  assert.equal(revoked.version, 2n); assert.deepEqual(revoked.principals.map(p => p.toText()), [primary.toText()]);
  service.setPrincipal(linked); assert.ok('Err' in await service.register_account(), 'completed denial survives deindexing');
  service.setPrincipal(governor); assert.ok('Err' in await service.begin_link(linked), 'unrelated account cannot restore revoked identity');
  assert.ok('Err' in await service.rekey_principal(primary, linked, true));
  assert.ok('Err' in await service.rekey_principal(primary, linked, false));
  for (const [index, group] of groups.entries()) {
    group.actor.setPrincipal(linked);
    await denied(() => group.actor.sync_my_linked_account());
    await denied(() => group.actor.read_account_my_role_grants());
    await denied(() => group.actor.read_my_club_memberships_indexed([], 100));
    group.actor.setPrincipal(primary); ok(await group.actor.sync_my_linked_account());
    assert.deepEqual(ok(await group.actor.read_my_club_memberships_indexed([], 100)).clubs, [`club-${index ? 'b' : 'a'}`]);
  }
  // Re-link and then replay the old removal. Receiver tombstones prevent a
  // delayed acknowledgement from destructively executing a second time.
  service.setPrincipal(primary); const next = ok(await service.begin_link(linked));
  service.setPrincipal(linked); ok(await service.accept_link(next.id));
  assert.ok('Err' in await service.accept_link(next.id), 'accepted relink cannot replay');
  service.setPrincipal(groups[0].canisterId);
  const relinkedEligibility = ok(await service.read_principal_eligibility(linked));
  assert.ok('Eligible' in relinkedEligibility.decision);
  assert.equal(relinkedEligibility.denied_through_version[0], 1n, 'explicit relink retains denial history');
  assert.equal(relinkedEligibility.account_version[0], 3n);
  for (const group of groups) {
    group.actor.setPrincipal(linked);
    assert.deepEqual(await group.actor.read_account_my_role_grants(), [], 'relink alone does not restore deleted domain grants');
    group.actor.setPrincipal(governor); ok(await group.actor.add_role_grant(linked, group === groups[0] ? 'club-a' : 'club-b', 'coach', []));
    group.actor.setPrincipal(identity.canisterId); ok(await group.actor.revoke_linked_principal(account.id, linked, 1n));
    group.actor.setPrincipal(linked); ok(await group.actor.sync_my_linked_account());
    assert.equal((await group.actor.read_account_my_role_grants()).length, 1);
    assert.equal(ok(await group.actor.read_my_club_memberships_indexed([], 100)).clubs.length, 1);
  }
  // Two callers replaying the same operation must never increment twice.
  const first = await submit(identityIdl, identity.canisterId, primary, 'revoke', [linked, 3n]);
  const second = await submit(identityIdl, identity.canisterId, primary, 'revoke', [linked, 3n]);
  const replies = await Promise.all([first(), second()]);
  assert.ok(replies.some(r => 'Ok' in r));
  service.setPrincipal(primary);
  const final = ok(await service.whoami());
  assert.equal(final.version, 4n);
  assert.deepEqual(final.principals.map(p => p.toText()), [primary.toText()]);
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: process.env.IDENTITY_ACCESS_WASM, sender: governor,
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  service.setPrincipal(linked);
  assert.ok('Err' in await service.register_account(), 'completed denial persists across identity upgrade');
  service.setPrincipal(groups[0].canisterId);
  const persistedEligibility = ok(await service.read_principal_eligibility(linked));
  assert.ok('Denied' in persistedEligibility.decision);
  assert.equal(persistedEligibility.denied_through_version[0], 3n);
  for (const group of groups) {
    group.actor.setPrincipal(linked); await denied(() => group.actor.read_account_my_role_grants());
    await denied(() => group.actor.sync_my_linked_account());
  }
  console.log('PASS: two-group recovery; restarted unacknowledged club denies protected reads/sync before retry while survivor retains club access; registration/rekey/unrelated-link denial, retained history, explicit newer relink without role restoration, upgrades and concurrent removal. Local rehearsal only: other-domain/global drain, restore and live opening remain unproven.');
} finally { await pic?.tearDown(); await server.stop(); }