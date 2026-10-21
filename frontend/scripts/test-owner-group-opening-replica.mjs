// Real signed owner opening/placement/create/readback/stop/upgrade. Other
// service IDs are metadata only; this is not all-service mainnet acceptance.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
const p = n => Principal.fromUint8Array(new Uint8Array([n, 1]));
const governor = p(1), owner = p(2), other = p(3), ok = r => { assert.ok('Ok' in r, r.Err); return r.Ok; };
const ids = [1, 2].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const names = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain', 'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const router = await pic.setupCanister({ idlFactory: routerIdl, wasm: process.env.SHARD_ROUTER_WASM, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.IDENTITY_ACCESS_WASM, sender: governor, controllers: [governor],
    environmentVariables: [{ name: 'IGNITE_BOUND_DELETION_RELEASE', value: '1' }], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]),
    environmentVariables: [{ name: 'IGNITE_NEW_CLUB_PLACEMENT_ROUTER', value: router.canisterId.toText() }, { name: 'IGNITE_NEW_CLUB_PLACEMENT_GROUP', value: 'g2' }, { name: 'IGNITE_NEW_CLUB_PLACEMENT_TARGET', value: 'ic' }] });
  const subnet = await pic.getCanisterSubnetId(club.canisterId); assert.ok(subnet);
  router.actor.setPrincipal(governor);
  const group = { id: 'g2', target_alias: 'ic', domains: names.map((domain, i) => ({ domain, canister: i === 0 ? club.canisterId : p(i + 30) })), accepting: false,
    max_clubs: 10, assigned_clubs: 0, heap_budget_bytes: 1_000_000_000n, heap_bytes: 0n, min_cycles: 1n, cycles: 0n, observed_at_ns: 0n, photo_store: [p(90)] };
  let revision = ok(await router.actor.register_group(group, await router.actor.version()));
  const placement = { group_id: 'g2', deployment_id: 'mainnet', deployment_revision: 1n, host: 'https://icp-api.io', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false, domains: group.domains.map(d => ({ ...d, subnet })) };
  revision = ok(await router.actor.register_group_placement(placement, revision));
  revision = ok(await router.actor.record_group_health('g2', 100n, 2_000_000_000_000n, revision));
  ok(await router.actor.set_deletion_authority(identity.canisterId));
  identity.actor.setPrincipal(governor);
  ok(await identity.actor.pin_owner_test_deletion_registry({ registry: router.canisterId, registry_revision: revision, target_alias: 'ic', deployment_id: 'mainnet', deployment_revision: 1n,
    host: 'https://icp-api.io', network_kind: 'public_mainnet' }));
  identity.actor.setPrincipal(owner); const ownerAccount = ok(await identity.actor.register_account());
  club.actor.setPrincipal(governor); ok(await club.actor.set_owner_test_deletion_identity(identity.canisterId));
  const actual = ok(await router.actor.read_group_registry('ic')).groups[0];
  const approval = { owner, group: actual, placement, club_ids: ids, expected_revision: revision, evidence_sha256: 'ab'.repeat(32) };
  router.actor.setPrincipal(owner); assert.ok('Err' in await router.actor.open_owner_test_group(approval));
  router.actor.setPrincipal(governor); assert.ok('Err' in await router.actor.open_owner_test_group({ ...approval, expected_revision: revision - 1n }));
  const receipt = ok(await router.actor.open_owner_test_group(approval));
  assert.deepEqual(ok(await router.actor.open_owner_test_group(approval)), receipt);
  router.actor.setPrincipal(other); assert.deepEqual(ok(await router.actor.read_my_owner_test_opening('ic')), []); assert.ok('Err' in await router.actor.place_my_new_club(ids[0], 'ic'));
  club.actor.setPrincipal(other); assert.ok('Err' in await club.actor.create_club(ids[0], 'Denied', 'denied', [], []));
  router.actor.setPrincipal(owner); const assigned = ok(await router.actor.place_my_new_club(ids[0], 'ic')); assert.equal(assigned.group_id, 'g2');
  club.actor.setPrincipal(owner); ok(await club.actor.create_club(ids[0], 'Owner test', 'owner-test', [], []));
  assert.deepEqual(ok(await club.actor.read_my_club_memberships_indexed([], 100)).clubs, [ids[0]]);
  // An assigned UUID is a positive control for the suspension rule: without
  // the identity check this exact create would succeed.
  const pending = ok(await router.actor.place_my_new_club(ids[1], 'ic'));
  identity.actor.setPrincipal(governor); ok(await identity.actor.set_account_status(ownerAccount.id, { Suspended: null }));
  club.actor.setPrincipal(owner); assert.ok('Err' in await club.actor.create_club(ids[1], 'Suspended pending', 'suspended-pending', [], []));
  router.actor.setPrincipal(owner); assert.ok('Err' in await router.actor.place_my_new_club(ids[1], 'ic'));
  identity.actor.setPrincipal(governor); ok(await identity.actor.set_account_status(ownerAccount.id, { Active: null }));
  club.actor.setPrincipal(owner); ok(await club.actor.create_club(ids[1], 'Resumed pending', 'resumed-pending', [], []));
  router.actor.setPrincipal(governor); ok(await router.actor.stop_owner_test_group('ic', await router.actor.version()));
  assert.equal(ok(await router.actor.list_groups())[0].accepting, false);
  router.actor.setPrincipal(owner); assert.ok('Err' in await router.actor.place_my_new_club('00000000-0000-4000-8000-000000000099', 'ic')); assert.deepEqual(ok(await router.actor.place_my_new_club(ids[1], 'ic')), pending); assert.deepEqual(ok(await router.actor.place_my_new_club(ids[0], 'ic')), assigned);
  assert.equal(ok(await router.actor.read_my_group_assignments([ids[0]], 'ic', await router.actor.version())).length, 1);
  identity.actor.setPrincipal(governor);
  // Eligibility uses current human account status; suspended owners cannot
  // turn a saved creator receipt into a fresh create or placement.
  ok(await identity.actor.set_account_status(ownerAccount.id, { Suspended: null }));
  club.actor.setPrincipal(owner); assert.ok('Err' in await club.actor.create_club(ids[1], 'Denied suspended', 'suspended', [], []));
  await pic.upgradeCanister({ canisterId: router.canisterId, wasm: process.env.SHARD_ROUTER_WASM, sender: governor });
  assert.equal(ok(await router.actor.read_my_owner_test_opening('ic'))[0].accepting_new, false);
  assert.equal(ok(await router.actor.read_my_group_assignments([ids[0]], 'ic', await router.actor.version())).length, 1);
  console.log('PASS: signed governor-only opening; owner-only explicit UUID placement; real club create/readback; nonowner/direct denial; stop retains access; persistent upgrade receipt; general accepting stays false.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }