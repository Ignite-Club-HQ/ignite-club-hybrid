// Bounded real router + two club-authority rehearsal, with production-default
// settings (no admission rehearsal flags). Not live opening authorization.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const principal = n => Principal.fromUint8Array(new Uint8Array([n, 1]));
const governor = principal(1), creator = principal(2), outsider = principal(3);
const domains = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain',
  'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];
const ok = r => { assert.ok('Ok' in r, String(r.Err)); return r.Ok; };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const router = await pic.setupCanister({ idlFactory: routerIdl, wasm: process.env.SHARD_ROUTER_WASM,
    sender: governor, controllers: [governor], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  const clubs = [];
  for (const groupId of ['g1', 'g2']) {
    const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM,
      environmentVariables: [{ name: 'IGNITE_NEW_CLUB_PLACEMENT_ROUTER', value: router.canisterId.toText() },
        { name: 'IGNITE_NEW_CLUB_PLACEMENT_GROUP', value: groupId }, { name: 'IGNITE_NEW_CLUB_PLACEMENT_TARGET', value: 'test' }],
      sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
    clubs.push(club);
    const subnet = await pic.getCanisterSubnetId(club.canisterId); assert.ok(subnet);
    const mapped = domains.map((domain, i) => ({ domain, canister: i === 0 ? club.canisterId : principal(i + (groupId === 'g1' ? 20 : 60)) }));
    router.actor.setPrincipal(governor);
    let revision = await router.actor.version();
    revision = ok(await router.actor.register_group({ id: groupId, target_alias: 'test', domains: mapped, accepting: true,
      max_clubs: 10, assigned_clubs: 0, heap_budget_bytes: 1_000_000_000n, heap_bytes: 0n, min_cycles: 1n,
      cycles: 0n, observed_at_ns: 0n, photo_store: [principal(groupId === 'g1' ? 110 : 111)] }, revision));
    revision = ok(await router.actor.register_group_placement({ group_id: groupId, deployment_id: 'isolated', deployment_revision: 1n,
      host: 'https://isolated.invalid', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet],
      additional_subnets_enabled: false, domains: mapped.map(d => ({ ...d, subnet })) }, revision));
    ok(await router.actor.record_group_health(groupId, 100n, 2_000_000_000_000n, revision));
    router.actor.setPrincipal(creator);
    const placement = ok(await router.actor.place_my_new_club(uuid(clubs.length), 'test'));
    assert.equal(placement.group_id, groupId);
    revision = await router.actor.version();
    assert.deepEqual(ok(await router.actor.read_my_new_club_placement(placement.club_id, 'test', revision)), placement);
    router.actor.setPrincipal(outsider);
    assert.ok('Err' in await router.actor.place_my_new_club(placement.club_id, 'test'));
    assert.ok('Err' in await router.actor.read_my_new_club_placement(placement.club_id, 'test', revision));
    router.actor.setPrincipal(creator);
    assert.ok('Err' in await router.actor.read_my_new_club_placement(placement.club_id, 'test', revision - 1n));
    club.actor.setPrincipal(creator);
    assert.ok('Err' in await club.actor.create_club(uuid(99), 'Unplaced', 'unplaced', [], []));
    club.actor.setPrincipal(outsider);
    assert.deepEqual(await club.actor.create_club(placement.club_id, 'Stolen', 'stolen', [], []), { Err: 'Original creator placement required' });
    club.actor.setPrincipal(creator);
    // Before creation an unavailable router cannot silently admit the caller.
    await pic.stopCanister({ canisterId: router.canisterId, sender: governor });
    assert.deepEqual(await club.actor.create_club(placement.club_id, 'Unavailable', 'unavailable', [], []), { Err: 'Original creator placement required' });
    await pic.startCanister({ canisterId: router.canisterId, sender: governor });
    ok(await club.actor.create_club(placement.club_id, `Test ${groupId}`, `test-${groupId}`, [], []));
    assert.deepEqual(ok(await club.actor.read_my_club_memberships_indexed([], 100)).clubs, [placement.club_id]);
    // Closing to placements must not remove assignment or member access.
    router.actor.setPrincipal(governor);
    const group = ok(await router.actor.list_groups()).find(g => g.id === groupId); assert.ok(group);
    ok(await router.actor.register_group({ ...group, accepting: false }, revision));
  }
  router.actor.setPrincipal(creator);
  const revision = await router.actor.version();
  assert.equal(ok(await router.actor.read_my_group_assignments([uuid(1), uuid(2)], 'test', revision)).length, 2);
  assert.ok('Err' in await router.actor.place_my_new_club(uuid(3), 'test'));
  // Retry is original-creator-only and does not reopen or consume a new slot.
  const prior = ok(await router.actor.read_my_new_club_placement(uuid(2), 'test', revision));
  assert.deepEqual(ok(await router.actor.place_my_new_club(uuid(2), 'test')), prior);
  await pic.upgradeCanister({ canisterId: router.canisterId, wasm: process.env.SHARD_ROUTER_WASM, sender: governor });
  assert.deepEqual(ok(await router.actor.read_my_new_club_placement(uuid(2), 'test', revision)), prior);
  router.actor.setPrincipal(outsider); assert.ok('Err' in await router.actor.read_my_new_club_placement(uuid(2), 'test', revision));
  assert.ok('Err' in await router.actor.read_my_group_assignments([uuid(1), uuid(2)], 'test', revision));
  assert.ok('Err' in await router.actor.read_new_club_creation_authorized(creator, uuid(2), 'test', 'g2'));
  const partial = await pic.setupCanister({ idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM,
    sender: governor, controllers: [governor], environmentVariables: [{ name: 'IGNITE_NEW_CLUB_PLACEMENT_GROUP', value: 'g2' }],
    arg: IDL.encode([IDL.Principal], [governor]) });
  partial.actor.setPrincipal(creator);
  assert.deepEqual(await partial.actor.create_club(uuid(99), 'Partial', 'partial', [], []), { Err: 'Original creator placement required' });
  clubs[1].actor.setPrincipal(governor); ok(await clubs[1].actor.remove_member(uuid(2), creator));
  router.actor.setPrincipal(creator);
  assert.equal(ok(await router.actor.read_my_group_assignments([uuid(1)], 'test', revision)).length, 1);
  assert.ok('Err' in await router.actor.read_my_group_assignments([uuid(2)], 'test', revision));
  clubs[1].actor.setPrincipal(creator); assert.deepEqual(ok(await clubs[1].actor.read_my_club_memberships_indexed([], 100)).clubs, []);
  router.actor.setPrincipal(governor); ok(await router.actor.set_deletion_authority(governor));
  ok(await router.actor.acquire_deletion_lock('locked-account', revision));
  router.actor.setPrincipal(creator); assert.ok('Err' in await router.actor.read_my_new_club_placement(uuid(2), 'test', revision));
  assert.ok('Err' in await router.actor.read_new_club_creation_authorized(creator, uuid(2), 'test', 'g2'));
  console.log('PASS: real creator-bound new-club placement in two authorities, readback, foreign/stale denial, stop-new-placement with retained access, upgrade ownership, club-only removal and deletion lock; other domain IDs are metadata fixtures, not full live opening evidence.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }