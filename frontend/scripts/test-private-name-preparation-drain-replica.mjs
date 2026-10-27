// Local-only fixture verifies a real outstanding callback across admission
// closure. Fixture Wasm is explicit, never a deploy target or production API.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PocketIc,PocketIcServer} from '@dfinity/pic';
import {IDL} from '@icp-sdk/core/candid';
import {Principal} from '@icp-sdk/core/principal';
const governor=Principal.fromUint8Array(Uint8Array.from([1,1]));
const request=IDL.Record({operation_id:IDL.Text,generation:IDL.Nat64,inventory_digest:IDL.Vec(IDL.Nat8)});
const receipt=IDL.Record({request,receiver:IDL.Principal,closing:IDL.Bool,sealed:IDL.Bool,active:IDL.Nat});
const result=IDL.Variant({Ok:IDL.Null,Err:IDL.Text});
const idlFactory=()=>IDL.Service({
  open_private_name_writer_window:IDL.Func([request],[result],[]),
  freeze_private_name_preparation:IDL.Func([request],[result],[]),
  read_private_name_preparation:IDL.Func([request],[IDL.Variant({Ok:receipt,Err:IDL.Text})],[]),
  activate_private_name_preparation:IDL.Func([request],[result],[]),
  tryConversion:IDL.Func([request],[result],[]),holdOrdinary:IDL.Func([],[],[]),releaseHeld:IDL.Func([],[],[]),
});
const server=await PocketIcServer.start({binPath:process.env.POCKET_IC_BIN||'/root/.cache/mops/pocket-ic/15.0.0/pocket-ic'});let pic;
try{
  pic=await PocketIc.create(server.getUrl());
  const service=await pic.setupCanister({idlFactory,wasm:readFileSync('/tmp/private-name-preparation-fixture.wasm'),sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])});
  service.actor.setPrincipal(governor);
  const old={operation_id:'names:ordinary-fixture',generation:1n,inventory_digest:Array(32).fill(1)},prep={...old,operation_id:'names:club-name-preparation-held-callback',generation:2n};
  assert.ok('Ok'in await service.actor.open_private_name_writer_window(old));
  const held=await pic.client.submitCall({canisterId:service.canisterId,sender:governor,method:'holdOrdinary',payload:IDL.encode([],[])});
  await pic.tick(5);
  assert.ok('Ok'in await service.actor.freeze_private_name_preparation(prep));
  const pending=await service.actor.read_private_name_preparation(prep);assert.ok('Ok'in pending);assert.equal(pending.Ok.active,1n);
  assert.ok('Err'in await service.actor.activate_private_name_preparation(prep));
  assert.ok('Err'in await service.actor.tryConversion(prep));
  assert.ok('Err'in await service.actor.open_private_name_writer_window({...old,generation:3n,operation_id:'other'}));
  await service.actor.releaseHeld();await pic.client.awaitCall(held);
  const drained=await service.actor.read_private_name_preparation(prep);assert.ok('Ok'in drained);assert.equal(drained.Ok.active,0n);assert.equal(drained.Ok.sealed,false);
  assert.ok('Err'in await service.actor.tryConversion(prep));
  console.log('PASS: real pre-existing callback retains active=1 after preparation admission closes, activation stays denied, original lease cleanup drains to zero without reset, unsigned conversion remains denied.');
}finally{if(pic)await pic.tearDown();await server.stop();}