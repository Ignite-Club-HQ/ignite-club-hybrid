// Isolated PocketIC only. Actual router endpoints; complete synthetic group
// records, not real service installations or membership/feature acceptance.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as baseIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
const wasm = process.env.SHARD_ROUTER_WASM;
if (!wasm) throw new Error('SHARD_ROUTER_WASM required; use isolated scale-probe Wasm');
const output = process.env.SCALE_REPORT_PATH || '/tmp/router-scale-report.json';
const owner = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const guest = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const domains = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain',
  'club_points_domain', 'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue',
  'pii_access_control', 'timer_jobs', 'secret_workload_identity'];
const idlFactory = args => {
  const service = baseIdl(args);
  const assignment = IDL.Record({ club_id: IDL.Text, group_id: IDL.Text, revision: IDL.Nat64 });
  const outcome = IDL.Variant({ Ok: assignment, Err: IDL.Text });
  return IDL.Service({ ...Object.fromEntries(service._fields), measure_scale_path: IDL.Func(
    [IDL.Text, IDL.Text, IDL.Text, IDL.Nat64],
    [IDL.Variant({ Ok: IDL.Record({ result: outcome, instructions: IDL.Nat64 }), Err: IDL.Text })], []) });
};
const ok = value => { assert.ok('Ok' in value, 'Expected successful reply: ' + ('Err' in value ? value.Err : '')); return value.Ok; };
const server = await PocketIcServer.start(); let pic;
const report = { environment: 'isolated PocketIC', metrics: 'IC performance_counter(0) path instructions; excludes ingress Candid and reply encoding', scenarios: [] };
try {
  pic = await PocketIc.create(server.getUrl());
  const arg = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor: owner }]);
  const { actor, canisterId } = await pic.setupCanister({ idlFactory, wasm, sender: owner, controllers: [owner], arg,
    environmentVariables: [{ name: 'IGNITE_SCALE_PROBE_LOCAL', value: '1' }] });
  actor.setPrincipal(owner);
  let revision = await actor.version();
  const subnet = await pic.getCanisterSubnetId(canisterId); assert.ok(subnet);
  let registered = 0;
  for (const count of [65, 500, 4096]) {
    while (registered < count) {
      const id = `g${String(registered).padStart(4, '0')}`;
      const mapped = domains.map((domain, i) => ({ domain, canister: Principal.fromUint8Array(Uint8Array.from([i + 20, 1])) }));
      revision = ok(await actor.register_group({ id, target_alias: 'local', domains: mapped, accepting: true,
        max_clubs: 100_000, assigned_clubs: 0, heap_budget_bytes: 1_000_000_000n, heap_bytes: 0n,
        min_cycles: 1n, cycles: 0n, observed_at_ns: 0n, photo_store: [] }, revision));
      revision = ok(await actor.register_group_placement({ group_id: id, deployment_id: 'local-replica', deployment_revision: 1n,
        host: 'https://isolated.invalid', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet],
        additional_subnets_enabled: false, domains: mapped.map(d => ({ ...d, subnet })) }, revision));
      registered++;
    }
    // Refresh after registration to avoid simulated elapsed-time ambiguity.
    for (let i = 0; i < count; i++) revision = ok(await actor.record_group_health(`g${String(i).padStart(4, '0')}`, 100n, 1_000_000_000_000n, revision));
    const club = `scale-club-${count}`;
    const probe = async (path, id = club, target = 'local', rev = revision) => ok(await actor.measure_scale_path(path, id, target, rev));
    const placed = await probe('place'); revision = ok(placed.result).revision;
    assert.equal(ok(placed.result).group_id, 'g0000');
    const retry = await probe('place'); assert.deepEqual(ok(retry.result), ok(placed.result));
    const hosted = await probe('hosted'); assert.deepEqual(ok(hosted.result), ok(placed.result));
    const foreign = await probe('hosted', club, 'foreign'); assert.ok('Err' in foreign.result);
    const conflict = await probe('place', `conflict-${count}`, 'local', revision + 1n); assert.ok('Err' in conflict.result);
    assert.equal(await actor.version(), revision);
    let cursor = [], seen = [], pages = 0;
    do {
      const page = ok(await actor.read_group_registry_page('local', [revision], cursor, 64));
      assert.equal(page.revision, revision); assert.ok(page.groups.length <= 64);
      assert.equal(page.groups.length, page.placements.length);
      seen.push(...page.groups.map(g => g.id)); cursor = page.next_cursor; pages++;
    } while (cursor.length);
    assert.equal(seen.length, count); assert.equal(new Set(seen).size, count);
    assert.ok('Err' in await actor.read_group_registry('local'));
    await pic.upgradeCanister({ canisterId, wasm, sender: owner, arg });
    assert.equal(await actor.version(), revision);
    const cold = await probe('place', `cold-${count}`); revision = ok(cold.result).revision;
    const afterUpgrade = ok(await actor.read_hosted_club_assignment(club, 'local', revision));
    assert.deepEqual(afterUpgrade, ok(placed.result));
    await pic.advanceTime(16 * 60 * 1000); await pic.tick();
    const expired = await probe('place', `expired-${count}`); assert.ok('Err' in expired.result);
    const expiredRetry = await probe('place'); assert.deepEqual(ok(expiredRetry.result), ok(placed.result));
    assert.equal(await actor.version(), revision);
    let exhausted;
    if (count === 4096) {
      for (let i = 0; i < count; i++) revision = ok(await actor.record_group_health(`g${String(i).padStart(4, '0')}`, 100n, 0n, revision));
      exhausted = await probe('place', 'all-exhausted');
      assert.ok('Err' in exhausted.result); assert.equal(await actor.version(), revision);
    }
    actor.setPrincipal(guest);
    assert.ok('Err' in await actor.measure_scale_path('place', 'unauthorized', 'local', revision));
    actor.setPrincipal(Principal.anonymous());
    assert.ok('Err' in await actor.read_hosted_club_assignment(club, 'local', revision));
    actor.setPrincipal(owner);
    const scenario = { groups: count, registryPages: pages, instructions: {
      placement: placed.instructions, retry: retry.instructions, hosted: hosted.instructions,
      foreignDenied: foreign.instructions, revisionDenied: conflict.instructions,
      coldIndexRebuildPlacement: cold.instructions, allExpiredDenied: expired.instructions,
      expiredRetry: expiredRetry.instructions, allExhaustedDenied: exhausted?.instructions } };
    report.scenarios.push(scenario);
    await writeFile(output, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    console.log('PASS', count, 'groups', JSON.stringify(scenario, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
} finally { if (pic) await pic.tearDown(); await server.stop(); }