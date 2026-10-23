import test from 'node:test';
import assert from 'node:assert/strict';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { runFill } from '../../scripts/membership-lookup-release-policy.mjs';
import { configureDirectorySources } from '../../scripts/membership-source-configuration.mjs';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';

const service = idlFactory({ IDL });
const method = service._fields.find(([name]) => name === 'advance_membership_directory_source')?.[1];
assert.ok(method, 'existing source-specific driver must exist in generated Candid');
const wireReply = reply => IDL.decode(method.retTypes, IDL.encode(method.retTypes, [reply]))[0];

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
    gate:async()=>{},persist:async()=>{},
    configure:async()=>encodeReply(service,'configure_membership_directory',{Ok:grants}),
    configuration:async()=>encodeReply(service,'read_membership_directory_configuration',{Ok:{binding,generation:1n,inventory_digest:grants[0].inventory_digest,sources:sources.map(s=>[s.groupId,s.authority]),enabled:true,app_enabled:false}}),
    sourceConfiguration:async s=>encodeReply(clubService,'read_membership_directory_source_binding',{Ok:stored.get(s.groupId)??{enabled:false,binding:[]}}),
    configureSource:async(s,g)=>{stored.set(s.groupId,{enabled:true,binding:[g]});return encodeReply(clubService,'configure_membership_directory_source',{Ok:null});},
  });
  assert.equal(result.ready,false);assert.equal(stored.size,2);
});