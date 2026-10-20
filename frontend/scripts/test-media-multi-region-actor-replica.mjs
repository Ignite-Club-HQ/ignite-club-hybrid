// Real actor rollover with an explicitly seeded LOCAL fixture, never mainnet.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const seeded = process.env.MEDIA_MULTI_ACTOR_WASM;
if (!seeded) throw new Error('MEDIA_MULTI_ACTOR_WASM must name the disposable local seeded actor');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const ok = r => { assert.ok('Ok' in r, String(r.Err)); return r.Ok; };
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/root/.cache/mops/pocket-ic/15.0.0/pocket-ic' });
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const env = [
    { name: 'GOVERNOR_PRINCIPAL', value: governor.toText() },
    { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' },
    { name: 'IGNITE_MEDIA_SLOT_LOCAL_REHEARSAL', value: '1' },
    { name: 'IGNITE_MEDIA_MULTI_REGION_LOCAL_REHEARSAL', value: '1' },
  ];
  // Create/fund before install: fixture initialization grows sparse Regions.
  const id = await pic.createCanister({ sender: governor, controllers: [governor], cycles: 1_000_000_000_000_000_000n,
    reservedCyclesLimit: 1_000_000_000_000_000_000n, freezingThreshold: 0n, environmentVariables: env });
  await pic.installCode({ canisterId: id, wasm: seeded, sender: governor });
  const a = pic.createActor(idlFactory, id); a.setPrincipal(governor);
  assert.ok('Err' in await a.set_capacity_limit(214_748_364_800n));
  ok(await a.enable_stable_media_storage());
  ok(await a.set_capacity_limit(214_748_364_800n));
  assert.equal((await a.get_usage()).capacity_limit_bytes, 214_748_364_800n);
  assert.ok('Err' in await a.set_capacity_limit(536_870_912_000n));
  const base = (await a.stable_storage_status()).allocated_bytes;
  assert.equal(base, 68_652_367_872n);
  const pending = ok(await a.begin_upload('users/rollover/file', 'application/octet-stream', 1_000_008n, 2));
  ok(await a.put_chunk(pending, 0, Buffer.alloc(1_000_000, 3)));
  assert.equal((await a.stable_storage_status()).allocated_bytes, base + 1_048_576n);
  await pic.upgradeCanister({ canisterId: id, wasm: seeded, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  ok(await a.put_chunk(pending, 1, Buffer.from('finished')));
  ok(await a.finalize_upload(pending));
  const read = await a.http_request({ url: '/users/rollover/file', method: 'GET', headers: [], body: [] });
  assert.equal(read.status_code, 200); assert.equal(read.body.length, 1_000_000);
  const token = read.streaming_strategy[0]?.Callback.token; assert.ok(token);
  assert.equal(Buffer.from((await a.http_request_streaming_callback(token)).body).toString(), 'finished');
  await pic.updateCanisterSettings({ canisterId: id, sender: governor, environmentVariables: env.filter(e => e.name !== 'IGNITE_MEDIA_MULTI_REGION_LOCAL_REHEARSAL') });
  // Keep this fixture's migration tail. A production module predates the
  // local seed migration and cannot be used as a backwards-migration test.
  await pic.upgradeCanister({ canisterId: id, wasm: seeded, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  // Production large mode keeps extra-Region writes on without the rehearsal flag.
  assert.equal((await a.http_request({ url: '/users/rollover/file', method: 'GET', headers: [], body: [] })).status_code, 200);
  const after = ok(await a.begin_upload('users/rollover/production', 'application/octet-stream', 1n, 1));
  ok(await a.abort_upload(after));
  ok(await a.delete_blob('users/rollover/file'));
  assert.equal((await a.get_usage()).total_bytes, 0n);
  console.log('PASS: real actor bank-one rollover, reserved slot/pending upgrade, streaming, 200 GiB production ceiling/500 GiB refusal and flag-off production writes/read/delete.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}