// Isolated management API capability/byte-equality verification; never mainnet.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { readSnapshotBytes, equalSnapshotBytes, snapshotReadTypes } from '../../scripts/media-snapshot-reader.mjs';
const owner = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const other = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const f = await pic.setupCanister({ sender: owner, controllers: [owner], idlFactory: ({ IDL }) => IDL.Service({}),
    wasm: Buffer.from('0061736d010000000503010001', 'hex') });
  const id = f.canisterId;
  const call = async (method, input, value, output, sender = owner) => {
    const reply = await pic.updateCall({ canisterId: Principal.managementCanister(), sender, method, arg: IDL.encode([input], [value]) });
    return IDL.decode(output, reply)[0];
  };
  const snapshotType = IDL.Record({ id: IDL.Vec(IDL.Nat8), taken_at_timestamp: IDL.Nat64, total_size: IDL.Nat64 });
  const takeType = IDL.Record({ canister_id: IDL.Principal, replace_snapshot: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  const take = async () => Buffer.from((await call('take_canister_snapshot', takeType, { canister_id: id, replace_snapshot: [] }, [snapshotType])).id).toString('hex');
  const types = snapshotReadTypes(IDL);
  const subnet = await pic.getCanisterSubnetId(id);
  assert.ok(subnet);
  const request = { canisterId: id.toText(), deploymentId: 'isolated-replica', subnetId: subnet.toText(), host: server.getUrl(), registryRevision: 'fixture-one' };
  const transport = {
    verifyStoppedPlacement: async r => {
      const status = await pic.canisterStatus({ canisterId: id, sender: owner });
      const actualSubnet = await pic.getCanisterSubnetId(id);
      return 'stopped' in status.status && r.canisterId === id.toText() && r.subnetId === actualSubnet?.toText();
    },
    readMetadata: async r => call('read_canister_snapshot_metadata', types.metadataInput, { canister_id: id, snapshot_id: Buffer.from(r.snapshotId, 'hex') }, [types.metadataOutput]),
    readData: async (r, kind) => (await call('read_canister_snapshot_data', types.dataInput, { canister_id: id, snapshot_id: Buffer.from(r.snapshotId, 'hex'), kind }, [types.dataOutput])).chunk,
  };
  await pic.setStableMemory(id, Buffer.alloc(65536, 7));
  await pic.stopCanister({ canisterId: id, sender: owner });
  const saved = await take();
  await assert.rejects(call('read_canister_snapshot_metadata', types.metadataInput, { canister_id: id, snapshot_id: Buffer.from(saved, 'hex') }, [types.metadataOutput], other));
  const baseline = await readSnapshotBytes({ ...request, snapshotId: saved }, transport);
  assert.equal(baseline.components.stable_memory.bytes, '65536');
  await pic.setStableMemory(id, Buffer.alloc(65536, 8));
  const changed = await take();
  const changedBytes = await readSnapshotBytes({ ...request, snapshotId: changed }, transport);
  assert.equal(equalSnapshotBytes(baseline, changedBytes), false);
  await call('load_canister_snapshot', IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) }),
    { canister_id: id, snapshot_id: Buffer.from(saved, 'hex'), sender_canister_version: [] }, []);
  const restored = await take();
  assert.equal(equalSnapshotBytes(baseline, await readSnapshotBytes({ ...request, snapshotId: restored }, transport)), true);
  console.log('PASS: real management snapshot reads deny noncontroller, detect changed stable bytes, and verify restored module/heap/stable equality while stopped.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}
