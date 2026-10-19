// Local-only real club authorities: legacy parent tokens, revocation and privacy.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const owner = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const admin = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const parent = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const stranger = Principal.fromUint8Array(Uint8Array.from([4, 1]));
const ok = r => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const groups = [];
  for (const suffix of ['a', 'b']) {
    const fixture = await pic.setupCanister({ idlFactory, wasm: process.env.CLUB_DOMAIN_WASM,
      sender: owner, controllers: [owner], arg: IDL.encode([IDL.Principal], [owner]) });
    const actor = fixture.actor; actor.setPrincipal(owner);
    const acl = { clubs: [`club-${suffix}`], teams: [{ id: `team-${suffix}`, club: `club-${suffix}` }],
      children: [{ id: `child-${suffix}`, club_id: [`club-${suffix}`], teams: [`team-${suffix}`], parent: [owner] }],
      roles: [{ user: admin, club: [`club-${suffix}`], team: [], role: 'club_admin' }], guardians: [], exclusions: [] };
    const revision = ok(await actor.replace_acl(0n, acl));
    groups.push({ ...fixture, acl, revision });
  }
  const { actor: a } = groups[0]; const { actor: b } = groups[1];
  a.setPrincipal(admin);
  assert.ok('Err' in await a.create_parent_invite('club-a', ['team-a'], 'child-b'));
  assert.ok('Err' in await a.create_parent_invite('club-a', ['team-a'], 'unknown-child'));
  assert.ok('Err' in await a.create_parent_invite('club-a', ['team-b'], 'child-a'));
  assert.ok('Err' in await a.create_pending_invite('guardian', 'club-a', ['team-a'], ['child-b'], 'opaque-email-ref', []));
  assert.ok('Err' in await a.create_pending_invite('guardian', 'club-a', ['team-a'], [], 'opaque-email-ref', []));
  const pendingGuardian = ok(await a.create_pending_invite('guardian', 'club-a', ['team-a'], ['child-a'], 'opaque-email-ref', [])).invite.id;
  const token = ok(await a.create_parent_invite('club-a', ['team-a'], 'child-a')).id;
  assert.match(token, /^inv-[a-f0-9]{32}$/);
  a.setPrincipal(parent); b.setPrincipal(parent);
  assert.ok('Err' in await b.get_parent_invite(token));
  assert.equal(ok(await a.get_parent_invite(token)).club_id, 'club-a');
  ok(await a.accept_parent_invite(token)); ok(await a.accept_parent_invite(token));
  assert.deepEqual((await a.list_my_children()).map(c => c.id), ['child-a']);
  assert.deepEqual(await b.list_my_children(), []);
  a.setPrincipal(stranger);
  assert.ok('Err' in await a.accept_parent_invite(token));
  assert.ok('Err' in await a.get_parent_invite(token));
  assert.ok('Err' in await a.list_child_guardians('child-a'));
  a.setPrincipal(parent); ok(await a.set_own_child_guardian('child-a', parent, false));
  assert.deepEqual(await a.list_my_children(), []);
  assert.ok('Err' in await a.get_parent_invite(token));
  assert.ok('Err' in await a.accept_parent_invite(token)); // Replay cannot re-add removed guardian.
  a.setPrincipal(admin);
  const removedIssuer = ok(await a.create_parent_invite('club-a', ['team-a'], 'child-a')).id;
  a.setPrincipal(owner); ok(await a.remove_member('club-a', admin));
  a.setPrincipal(parent);
  assert.ok('Err' in await a.get_parent_invite(removedIssuer));
  assert.ok('Err' in await a.accept_parent_invite(removedIssuer));
  assert.ok('Err' in await a.accept_pending_invite(pendingGuardian));
  a.setPrincipal(owner);
  const fencedToken = ok(await a.create_parent_invite('club-a', ['team-a'], 'child-a')).id;
  ok(await a.freeze_club('club-a', 1n)); a.setPrincipal(parent);
  assert.ok('Err' in await a.accept_parent_invite(fencedToken));
  a.setPrincipal(owner); ok(await a.unfreeze_club('club-a', 1n));
  await pic.upgradeCanister({ canisterId: groups[0].canisterId, wasm: process.env.CLUB_DOMAIN_WASM, sender: owner,
    arg: IDL.encode([IDL.Principal], [owner]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  a.setPrincipal(parent); ok(await a.accept_parent_invite(fencedToken));
  ok(await a.erase_my_membership());
  assert.deepEqual(ok(await a.read_my_club_memberships_indexed([], 100)).clubs, []);
  assert.ok('Err' in await a.accept_parent_invite(fencedToken));
  console.log('PASS: two isolated club authorities; random legacy parent tokens; foreign/missing child denial; guardian-only privacy; claimant replay; removed guardian/issuer denial; fences; EOP preservation; membership erasure. No live deployment or device acceptance.');
} finally { await pic?.tearDown(); await server.stop(); }