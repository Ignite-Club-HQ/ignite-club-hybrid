import test from 'node:test';
import assert from 'node:assert/strict';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { runFill } from '../../scripts/membership-lookup-release-policy.mjs';
import { configureDirectorySources } from '../../scripts/membership-source-configuration.mjs';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { runOwnershipAcceptance } from '../../scripts/membership-ownership-acceptance.mjs';
import { checkHistoricalAcceptance, checkReplicaAcceptance } from '../../scripts/membership-acceptance-checks.mjs';

const service = idlFactory({ IDL });
const method = service._fields.find(([name]) => name === 'advance_membership_directory_source')?.[1];
assert.ok(method, 'existing source-specific driver must exist in generated Candid');
const wireReply = reply => IDL.decode(method.retTypes, IDL.encode(method.retTypes, [reply]))[0];
test('generated ownership operation has no observer proof input and records exact historical acceptance only', async () => {
  const ownership = service._fields.find(([name]) => name === 'advance_membership_directory_ownership')?.[1];assert.ok(ownership);
  assert.equal(ownership.argTypes.length, 0);
  const inventoryDigest = new Uint8Array(32).fill(3);
  const p = { scanned: 100n, clubs: 206n, complete: true, inventory_digest: inventoryDigest, source_revisions: [['g1', 7n], ['g2', 9n]], verified_current: false };
  const reply = IDL.decode(ownership.retTypes, IDL.encode(ownership.retTypes, [{ Ok: p }]))[0];
  const result = await runOwnershipAcceptance(async () => reply, { inventoryDigest, sources: [{ groupId: 'g1' }, { groupId: 'g2' }], completed: { g1: 7n, g2: 9n } });
  assert.equal(result.clubs, 206n);assert.equal(result.ready, false);assert.equal(result.appEnabled, false);
});

test('generated source-specific Candid replies drive both fills without a synthetic complete flag', async () => {
  const calls = [], saved = [];
  const steps = { g1: ['pull', 'materialize', 'published', 'acknowledged'], g2: ['published', 'acknowledged'] };
  const result = await runFill(['g1', 'g2'], async source => {
    const [decoded] = IDL.decode(method.argTypes, IDL.encode(method.argTypes, [source]));
    calls.push(decoded);
    return wireReply({ Ok: { source: decoded, phase: steps[source].shift(), revision: source === 'g1' ? 7n : 12n, scanned: 100n } });
  }, { persist: async (source, revision) => { saved.push([source, revision]); } });
  assert.deepEqual(calls, ['g1', 'g1', 'g1', 'g1', 'g2', 'g2']);
  assert.deepEqual(saved, [['g1', 7n], ['g2', 12n]]);
  assert.deepEqual(result, { g1: 7n, g2: 12n });
  assert.equal(service._fields.some(([name]) => name === 'advance_membership_directory'), false);
});

test('a generated definite refusal stops before persistence or the other source', async () => {
  let persisted = false, calls = 0;
  await assert.rejects(() => runFill(['g1', 'g2'], async () => {
    calls++; return wireReply({ Err: 'Membership directory unconfigured' });
  }, { persist: async () => { persisted = true; } }), /unconfigured/);
  assert.equal(calls, 1);
  assert.equal(persisted, false);
});

test('source configuration orchestration uses both generated identity and club contracts', async () => {
  const p = n => Principal.fromUint8Array(Uint8Array.of(n, 1));
  const binding = { registry:p(1),registry_revision:9n,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet' };
  const sources = ['g1', 'g2'].map((groupId, n) => ({ groupId, authority:p(n+2) }));
  const grants = sources.map(s => ({ identity:p(9), router:binding.registry, group:s.groupId,deployment:'mainnet',generation:1n,inventory_digest:new Uint8Array(32).fill(1) }));
  const encodeReply = (idl, name, response) => { const fn = idl._fields.find(([key]) => key === name)?.[1]; assert.ok(fn); return IDL.decode(fn.retTypes, IDL.encode(fn.retTypes, [response]))[0]; };
  const stored = new Map();const clubService = clubIdl({ IDL });
  const result = await configureDirectorySources(binding, sources, 1n, {
    identity:p(9),
    gate:async()=>{},persist:async()=>{},
    configure:async()=>encodeReply(service,'configure_membership_directory',{Ok:grants}),
    configuration:async()=>encodeReply(service,'read_membership_directory_configuration',{Ok:{binding,generation:1n,inventory_digest:grants[0].inventory_digest,sources:sources.map(s=>[s.groupId,s.authority]),enabled:true,app_enabled:false}}),
    sourceConfiguration:async s=>encodeReply(clubService,'read_membership_directory_source_binding',{Ok:stored.get(s.groupId)??{enabled:false,binding:[]}}),
    configureSource:async(s,g)=>{stored.set(s.groupId,{enabled:true,binding:[g]});return encodeReply(clubService,'configure_membership_directory_source',{Ok:null});},
  });
  assert.equal(result.ready,false);assert.equal(stored.size,2);
});
test('final acceptance uses generated governor status and identity configuration without fabricating currentness', async () => {
  const p = n => Principal.fromUint8Array(Uint8Array.of(n, 1));
  const sources = ['g1', 'g2'].map((groupId, n) => ({ groupId, authority:p(n+2) }));
  const completed = { g1:7n, g2:9n }, inventoryDigest = new Uint8Array(32).fill(3), generation = 1n;
  const binding = { registry:p(1),registry_revision:9n,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet' };
  const club = clubIdl({ IDL }), targets = [{ newHash:'a'.repeat(64),settingsHash:'b'.repeat(64) }];
  const roundtrip = (idl, name, reply) => { const fn = idl._fields.find(([key]) => key === name)?.[1];assert.ok(fn);assert.equal(fn.argTypes.length,0);return IDL.decode(fn.retTypes,IDL.encode(fn.retTypes,[reply]))[0]; };
  const result = await checkHistoricalAcceptance({ sources,completed,inventoryDigest,generation,binding,targets,
    ownership:{ complete:true,verified_current:false,inventory_digest:inventoryDigest,source_revisions:[['g1',7n],['g2',9n]] } }, {
    gate:async()=>{},
    configuration:async()=>roundtrip(service,'read_membership_directory_configuration',{Ok:{binding,generation,inventory_digest:inventoryDigest,sources:sources.map(s=>[s.groupId,s.authority]),enabled:true,app_enabled:false}}),
    status:async s=>roundtrip(club,'read_membership_discovery_status',{Ok:{revision:completed[s.groupId],acknowledged:completed[s.groupId],pending:false}}),
    observe:async t=>({moduleHash:t.newHash,settingsHash:t.settingsHash}),
  });
  assert.equal(result.sampledCurrent,true);assert.equal(result.verified_current,false);assert.equal(result.ready,false);
});
test('generated replica-owned acceptance cannot be replaced by readiness booleans or partial revisions', async () => {
  const fn = service._fields.find(([name]) => name === 'check_membership_directory_acceptance')?.[1];assert.ok(fn);assert.equal(fn.argTypes.length,0);
  const sources = [{groupId:'g1'},{groupId:'g2'}],completed={g1:7n,g2:9n};
  const wire = response => IDL.decode(fn.retTypes,IDL.encode(fn.retTypes,[response]))[0];
  const valid = {snapshot_verified:true,restoration_guard_verified:true,source_revisions:[['g1',7n],['g2',9n]],verified_current:false,app_enabled:false};
  const result=await checkReplicaAcceptance(sources,completed,{gate:async()=>{},check:async()=>wire({Ok:valid})});
  assert.equal(result.snapshotVerified,true);assert.equal(result.restorationGuardVerified,true);assert.equal(result.appEnabled,false);
  for(const bad of [{...valid,restoration_guard_verified:false},{...valid,source_revisions:[['g1',7n]]},{...valid,verified_current:true},{...valid,app_enabled:true}]) await assert.rejects(()=>checkReplicaAcceptance(sources,completed,{gate:async()=>{},check:async()=>wire({Ok:bad})}));
  await assert.rejects(()=>checkReplicaAcceptance(sources,completed,{gate:async()=>{},check:async()=>wire({Err:'Directory lifecycle changed'})}),/lifecycle/);
});