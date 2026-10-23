import test from 'node:test';
import assert from 'node:assert/strict';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { runFill } from '../../scripts/membership-lookup-release-policy.mjs';

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