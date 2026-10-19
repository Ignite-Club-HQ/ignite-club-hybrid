// Isolated registry metadata only; domain IDs are placeholders, not live services.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), outsider = p(2);
const domains = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain',
  'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const denied = r => assert.ok('Err' in r, 'Expected explicit denial');
const identityWasm = resolve('target/wasm32-unknown-unknown/release/identity_access.wasm');
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/tmp/pocket-ic' }); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const args = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]);
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: identityWasm, sender: governor, controllers: [governor],
    environmentVariables: [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }], arg: args });
  const router = await pic.setupCanister({ idlFactory: routerIdl, wasm: resolve('target/wasm32-unknown-unknown/release/shard_router.wasm'),
    sender: governor, controllers: [governor], arg: args });
  const actor = identity.actor; actor.setPrincipal(governor); router.actor.setPrincipal(governor);
  const subnet = await pic.getCanisterSubnetId(router.canisterId); assert.ok(subnet);
  const clubs = [], mappedGroups = [];
  for (let n = 0; n < 2; n++) {
    const club = await pic.createCanister({ sender: governor, controllers: [governor] }); clubs.push(club);
    const mapped = domains.map((domain, i) => ({ domain, canister: i === 0 ? club : p(10 + n * 20 + i) })); mappedGroups.push(mapped);
    let rev = await router.actor.version();
    rev = ok(await router.actor.register_group({ id: `g${n}`, target_alias: 'local', domains: mapped, accepting: false, max_clubs: 100,
      assigned_clubs: 0, heap_budget_bytes: 1_000_000n, heap_bytes: 0n, min_cycles: 1n, cycles: 0n, observed_at_ns: 0n }, rev));
    ok(await router.actor.register_group_placement({ group_id: `g${n}`, deployment_id: 'isolated-replica', deployment_revision: 1n,
      host: 'https://isolated.invalid', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet],
      additional_subnets_enabled: false, domains: mapped.map(d => ({ ...d, subnet })) }, rev));
  }
  ok(await actor.set_club_authorities(clubs)); ok(await actor.set_service_authorities([mappedGroups[0][1].canister]));
  const revision = async () => ok(await actor.read_removal_history_manifest()).revision;
  denied(await actor.read_group_inventory_evidence(await revision()));
  let binding = { registry: router.canisterId, registry_revision: await router.actor.version(), target_alias: 'local',
    deployment_id: 'isolated-replica', deployment_revision: 1n, host: 'https://isolated.invalid', network_kind: 'public_mainnet' };
  const originalHistory = await revision(); ok(await actor.set_group_inventory_binding(binding, originalHistory));
  denied(await actor.read_group_inventory_evidence(originalHistory)); let history = await revision();
  const evidence = ok(await actor.read_group_inventory_evidence(history));
  assert.equal(evidence.snapshot.groups.length, 2); assert.equal(evidence.snapshot.placements.length, 2);
  assert.equal(evidence.snapshot.groups.reduce((n, g) => n + g.domains.length, 0), 26);
  assert.equal(evidence.binding.registry.toText(), router.canisterId.toText()); assert.equal(evidence.history_revision, history);
  actor.setPrincipal(outsider); denied(await actor.read_group_inventory_evidence(history)); denied(await actor.set_group_inventory_binding(binding, history));
  actor.setPrincipal(Principal.anonymous()); denied(await actor.read_group_inventory_evidence(history)); actor.setPrincipal(governor);
  for (const change of [{ registry: p(99) }, { deployment_id: 'foreign' }, { registry_revision: binding.registry_revision - 1n }]) {
    denied(await actor.set_group_inventory_binding({ ...binding, ...change }, history));
  }
  assert.equal(await revision(), history, 'Rejected substitutions leave history intact');
  const newer = ok(await router.actor.record_group_health('g0', 0n, 1n, binding.registry_revision));
  denied(await actor.read_group_inventory_evidence(history)); binding = { ...binding, registry_revision: newer };
  ok(await actor.set_group_inventory_binding(binding, history)); history = await revision(); ok(await actor.read_group_inventory_evidence(history));
  // Stop the actual registry before submitting a read, mutate readers, resume.
  await pic.stopCanister({ canisterId: router.canisterId, sender: governor });
  const signature = new Map(identityIdl({ IDL })._fields).get('read_group_inventory_evidence'); assert.ok(signature);
  const message = await pic.client.submitCall({ canisterId: identity.canisterId, sender: governor, method: 'read_group_inventory_evidence',
    payload: new Uint8Array(IDL.encode(signature.argTypes, [history])) });
  await pic.tick(1); ok(await actor.set_service_authorities([mappedGroups[0][1].canister, mappedGroups[1][1].canister]));
  await pic.startCanister({ canisterId: router.canisterId, sender: governor });
  denied(IDL.decode(signature.retTypes, (await pic.client.awaitCall(message)).body)[0]);
  history = await revision(); ok(await actor.read_group_inventory_evidence(history));
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: identityWasm, sender: governor, wasmMemoryPersistence: 'keep' });
  denied(await actor.read_group_inventory_evidence(history)); history = await revision();
  assert.equal(ok(await actor.read_group_inventory_evidence(history)).binding.registry.toText(), router.canisterId.toText());
  // A missing service reader (including media) cannot silently disappear.
  ok(await actor.set_service_authorities([mappedGroups[0][1].canister, mappedGroups[1][1].canister, p(99)]));
  history = await revision(); denied(await actor.read_group_inventory_evidence(history));
  const production = await pic.setupCanister({ idlFactory: identityIdl, wasm: identityWasm, sender: governor, controllers: [governor], arg: args });
  production.actor.setPrincipal(governor); denied(await production.actor.set_group_inventory_binding(binding, 0n));
  denied(await production.actor.read_group_inventory_evidence(0n));
  console.log('PASS: real registry→identity consensus, two-group/26-domain metadata, pinned trust, stale callback/revision denial, missing reader, upgrade preservation and closed production gates. NOT media completeness or global drain.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }