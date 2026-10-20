// Isolated two-group authoritative discovery/permission rehearsal, never mainnet.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const root = resolve('..');
const owner = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const member = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const stranger = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const domains = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain',
  'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];
const ok = r => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const routerWasm = resolve(root, 'target/wasm32-unknown-unknown/release/shard_router.wasm');
  const router = await pic.setupCanister({ idlFactory: routerIdl, wasm: routerWasm, sender: owner, controllers: [owner],
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor: owner }]) });
  router.actor.setPrincipal(owner);
  const clubs = [];
  for (const id of ['a', 'b']) {
    const fixture = await pic.setupCanister({ idlFactory: clubIdl, wasm: resolve(root, 'backend/club_domain/.mops/.build/club_domain.wasm'),
      sender: owner, controllers: [owner], arg: IDL.encode([IDL.Principal], [owner]) });
    fixture.actor.setPrincipal(owner);
    ok(await fixture.actor.create_club(`club-${id}`, `Club ${id}`, `club-${id}`, [], []));
    ok(await fixture.actor.add_role_grant(member, `club-${id}`, 'player', []));
    clubs.push(fixture);
    const subnet = await pic.getCanisterSubnetId(fixture.canisterId); assert.ok(subnet);
    const mapped = domains.map((domain, i) => ({ domain, canister: i === 0 ? fixture.canisterId : Principal.fromUint8Array(Uint8Array.from([i + 20, id.charCodeAt(0), 1])) }));
    let revision = await router.actor.version();
    revision = ok(await router.actor.register_group({ id, target_alias: 'local', domains: mapped, accepting: true, max_clubs: 100,
      assigned_clubs: 0, heap_budget_bytes: 1_000_000_000n, heap_bytes: 0n, min_cycles: 1n, cycles: 0n, observed_at_ns: 0n, photo_store: [] }, revision));
    revision = ok(await router.actor.register_group_placement({ group_id: id, deployment_id: 'local-replica', deployment_revision: 1n,
      host: 'https://isolated.invalid', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet],
      additional_subnets_enabled: false, domains: mapped.map(d => ({ ...d, subnet })) }, revision));
    revision = ok(await router.actor.record_group_health(id, 100n, 1_000_000_000_000n, revision));
    const assigned = ok(await router.actor.assign_new_club_group(`club-${id}`, 'local', revision));
    assert.equal(assigned.group_id, id === 'b' ? 'b' : 'a');
  }
  const revision = await router.actor.version();
  router.actor.setPrincipal(member);
  assert.equal(ok(await router.actor.read_group_registry('local')).groups.length, 2);
  assert.ok('Err' in await router.actor.list_groups()); // Original governor gate preserved.
  const assignments = ok(await router.actor.read_my_group_assignments(['club-a', 'club-b'], 'local', revision));
  assert.equal(assignments.length, 2);
  assert.ok('Err' in await router.actor.read_my_group_assignments(['club-a'], 'other-engine', revision));
  assert.ok('Err' in await router.actor.read_my_group_assignments(['club-a'], 'local', revision - 1n));
  assert.ok('Err' in await router.actor.read_my_group_assignments(['club-a', 'club-a'], 'local', revision));
  for (let i = 0; i < clubs.length; i++) {
    clubs[i].actor.setPrincipal(member);
    const page = ok(await clubs[i].actor.read_my_club_memberships(0n, 100));
    assert.deepEqual(page.clubs, [`club-${i === 0 ? 'a' : 'b'}`]);
    clubs[i].actor.setPrincipal(stranger);
    assert.deepEqual(ok(await clubs[i].actor.read_my_club_memberships(0n, 100)).clubs, []);
  }
  router.actor.setPrincipal(stranger);
  assert.ok('Err' in await router.actor.read_my_group_assignments(['club-a'], 'local', revision));
  router.actor.setPrincipal(Principal.anonymous());
  assert.ok('Err' in await router.actor.read_group_registry('local'));
  assert.ok('Err' in await router.actor.read_my_group_assignments(['club-a'], 'local', revision));
  clubs[1].actor.setPrincipal(owner); ok(await clubs[1].actor.remove_member('club-b', member));
  router.actor.setPrincipal(member);
  assert.ok('Err' in await router.actor.read_my_group_assignments(['club-a', 'club-b'], 'local', revision));
  assert.equal(ok(await router.actor.read_my_group_assignments(['club-a'], 'local', revision)).length, 1);
  clubs[1].actor.setPrincipal(member);
  assert.deepEqual(ok(await clubs[1].actor.read_my_club_memberships(0n, 100)).clubs, []);
  await pic.upgradeCanister({ canisterId: router.canisterId, wasm: routerWasm, sender: owner });
  assert.equal(ok(await router.actor.read_group_registry('local')).placements.length, 2);
  assert.equal(await router.actor.version(), revision);
  await pic.stopCanister({ canisterId: clubs[0].canisterId, sender: owner });
  assert.ok('Err' in await router.actor.read_my_group_assignments(['club-a'], 'local', revision));
  console.log('PASS: two real club authorities, private member pages, consensus assignment checks, revocation, anonymous/foreign/stale denial, upgrade persistence and unavailable authority. Other domain IDs are fixtures; no complete feature-group or engine claim.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }