// Local-only sparse multi-Region boundary and actual memory-preserving upgrade.
// Build backend/media_blob_store/fixtures/multiRegionBytesBoundary.mo with the
// pinned compiler and --max-stable-pages 3276800; pass its path explicitly.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
const wasm = process.env.MEDIA_BOUNDARY_WASM;
if (!wasm) throw new Error('MEDIA_BOUNDARY_WASM must name the local-only sparse fixture');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const idlFactory = () => IDL.Service({ runTests: IDL.Func([], [], []), verifyUpgrade: IDL.Func([], [], []) });
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/root/.cache/mops/pocket-ic/15.0.0/pocket-ic' });
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const f = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], cycles: 1_000_000_000_000_000_000n,
    reservedCyclesLimit: 1_000_000_000_000_000_000n, freezingThreshold: 0n });
  f.actor.setPrincipal(governor);
  await f.actor.runTests();
  await pic.upgradeCanister({ canisterId: f.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  await f.actor.verifyUpgrade();
  console.log('PASS: real sparse writes across banks at 64/128/192 GiB virtual addresses, isolation, returned-error non-mutation, reuse and all-bank upgrade preservation; 500 GiB physical allocation explicitly refused.');
  assert.ok(f.canisterId);
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}