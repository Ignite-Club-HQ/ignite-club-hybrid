// Actual router update/placement/upgrade evidence; no mainnet calls.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
const p = n => Principal.fromUint8Array(new Uint8Array([n, 1]));
const governor = p(1), user = p(2), ok = r => { assert.ok('Ok' in r, r.Err); return r.Ok; };
const names = ['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const router = await pic.setupCanister({ idlFactory, wasm: process.env.SHARD_ROUTER_WASM, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  router.actor.setPrincipal(governor);
  const group = { id:'g2',target_alias:'ic',domains:names.map((domain,i)=>({domain,canister:p(30+i)})),accepting:true,max_clubs:10,assigned_clubs:0,heap_budget_bytes:1_000_000_000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n,photo_store:[p(90)] };
  let rev = ok(await router.actor.register_group(group, await router.actor.version()));
  rev = ok(await router.actor.record_group_health('g2',100n,2_000_000_000_000n,rev));
  const id='00000000-0000-4000-8000-000000000001';
  const assigned=ok(await router.actor.assign_new_club_group(id,'ic',rev));
  rev=await router.actor.version();
  for (const unauthorized of [user,Principal.anonymous()]) {
    router.actor.setPrincipal(unauthorized);
    assert.ok('Err' in await router.actor.stop_group_new_placements('g2','ic',rev));
  }
  router.actor.setPrincipal(governor);
  assert.ok('Err' in await router.actor.stop_group_new_placements('g2','ic',rev+1n));
  const before=ok(await router.actor.list_groups())[0];
  rev=ok(await router.actor.stop_group_new_placements('g2','ic',rev));
  assert.deepEqual(ok(await router.actor.list_groups())[0],{...before,accepting:false});
  assert.deepEqual(ok(await router.actor.assign_new_club_group(id,'ic',rev)),assigned);
  assert.ok('Err' in await router.actor.assign_new_club_group('00000000-0000-4000-8000-000000000002','ic',rev));
  assert.equal(ok(await router.actor.stop_group_new_placements('g2','ic',rev)),rev);
  await pic.upgradeCanister({canisterId:router.canisterId,wasm:process.env.SHARD_ROUTER_WASM,sender:governor});
  assert.equal(ok(await router.actor.list_groups())[0].accepting,false);
  assert.deepEqual(ok(await router.actor.get_group_assignment(id))[0],assigned);
  console.log('PASS: real signed administrator stop, unauthorized/stale denial, no new placements, unchanged existing assignment, persistent upgrade state.');
} finally {if(pic) await pic.tearDown(); await server.stop();}