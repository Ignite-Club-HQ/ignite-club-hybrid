// Real local management calls plus durable receipts. No production connection.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { snapshotReadTypes } from '../../scripts/media-snapshot-reader.mjs';
import { createRecoverySnapshotVerification } from '../../scripts/media-recovery-snapshots.mjs';
import { runRecoveryAction } from '../../scripts/media-recovery-receipts.mjs';
const owner = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const directory = await mkdtemp(join(tmpdir(), 'recovery-replica-'));
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const f = await pic.setupCanister({ sender: owner, controllers: [owner], idlFactory: ({ IDL }) => IDL.Service({}),
      wasm: Buffer.from('0061736d010000000503010001', 'hex') });
    ids.push(f.canisterId.toText());
    await pic.setStableMemory(f.canisterId, Buffer.alloc(65536, 7));
  }
  const inv = { deploymentId: 'isolated', authority: ids[2], stores: ids.slice(0, 2) };
  const subnets = {};
  for (const id of ids) {
    const subnet = await pic.getCanisterSubnetId(Principal.fromText(id)); assert.ok(subnet);
    subnets[id] = subnet.toText();
  }
  // Logical HTTPS origin is a local fixture binding, not an actual remote host.
  const placement = { deploymentId: 'isolated', network: 'pocketic', host: 'https://isolated.invalid', registryRevision: 'fixture', subnets };
  const call = async (method, input, value, output) => {
    const reply = await pic.updateCall({ canisterId: Principal.managementCanister(), sender: owner, method, arg: IDL.encode([input], [value]) });
    return IDL.decode(output, reply)[0];
  };
  const snapshotType = IDL.Record({ id: IDL.Vec(IDL.Nat8), taken_at_timestamp: IDL.Nat64, total_size: IDL.Nat64 });
  const takeType = IDL.Record({ canister_id: IDL.Principal, replace_snapshot: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  const types = snapshotReadTypes(IDL); const starts = [];
  const adapter = {
    readInventory: async () => structuredClone(inv),
    verifyRecoveryPlacement: async p => {
      if (JSON.stringify(p) !== JSON.stringify(placement)) return false;
      for (const id of ids) if ((await pic.getCanisterSubnetId(Principal.fromText(id)))?.toText() !== p.subnets[id]) return false;
      return true;
    },
    stop: async id => pic.stopCanister({ canisterId: Principal.fromText(id), sender: owner }),
    status: async id => Object.keys((await pic.canisterStatus({ canisterId: Principal.fromText(id), sender: owner })).status)[0],
    takeSnapshot: async id => Buffer.from((await call('take_canister_snapshot', takeType,
      { canister_id: Principal.fromText(id), replace_snapshot: [] }, [snapshotType])).id).toString('hex'),
    loadSnapshot: async (id, snapshotId) => call('load_canister_snapshot', IDL.Record({ canister_id: IDL.Principal,
      snapshot_id: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) }),
      { canister_id: Principal.fromText(id), snapshot_id: Buffer.from(snapshotId, 'hex'), sender_canister_version: [] }, []),
    start: async id => { starts.push(id); await pic.startCanister({ canisterId: Principal.fromText(id), sender: owner }); },
    // These minimal fixtures have no quota ledger; this is not ledger verification.
    verifyConsistency: async () => true,
  };
  const transport = {
    verifyStoppedPlacement: async r => ids.includes(r.canisterId) && await adapter.status(r.canisterId) === 'stopped' &&
      (await pic.getCanisterSubnetId(Principal.fromText(r.canisterId)))?.toText() === r.subnetId,
    readMetadata: async r => call('read_canister_snapshot_metadata', types.metadataInput,
      { canister_id: Principal.fromText(r.canisterId), snapshot_id: Buffer.from(r.snapshotId, 'hex') }, [types.metadataOutput]),
    readData: async (r, kind) => (await call('read_canister_snapshot_data', types.dataInput,
      { canister_id: Principal.fromText(r.canisterId), snapshot_id: Buffer.from(r.snapshotId, 'hex'), kind }, [types.dataOutput])).chunk,
  };
  const verification = createRecoverySnapshotVerification(inv, placement, adapter, transport);
  const run = (action, approved = false) => runRecoveryAction(directory, inv, adapter, action, approved, verification);
  await run('checkpoint');
  const baseline = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
  assert.equal(baseline.snapshotBaseline.participants.length, 3);
  await pic.setStableMemory(Principal.fromText(ids[0]), Buffer.alloc(65536, 9));
  await assert.rejects(run('resume', true), /bytes differ/); assert.deepEqual(starts, []);
  await run('restore');
  assert.deepEqual(Buffer.from(await pic.getStableMemory(Principal.fromText(ids[0]))), Buffer.alloc(65536, 7));
  await run('resume', true);
  assert.deepEqual(starts, [inv.authority, ...inv.stores]);
  assert.equal(JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8')).phase, 'resumed');
  console.log('PASS: real three-canister snapshot receipts reject changed stable bytes, replay complete restore and resume authority-first. No ledger or production claim.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
  await rm(directory, { recursive: true, force: true });
}