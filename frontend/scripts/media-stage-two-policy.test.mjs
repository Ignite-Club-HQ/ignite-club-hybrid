import test from 'node:test';
import assert from 'node:assert/strict';
import { approveTest, assertFuel, assertTarget, assertResume, environmentFor, CONFIRM, FUEL_FLOOR, CALL_RESERVE, GiB } from './media-stage-two-policy.mjs';
const input = { runId: 'test-001', scenario: 'mixed', budgetT: '5', confirm: CONFIRM, governor: 'governor', subnetId: 'subnet', wasmSha256: 'a'.repeat(64) };
const binding = approveTest(input);
test('mixed uses exactly 5 GiB; tiny uses a separate 512 MiB scenario', () => {
  assert.equal(binding.capacityBytes, 5 * GiB);
  assert.equal(approveTest({ ...input, scenario: 'tiny' }).capacityBytes, 512 * 1024 ** 2);
});
test('spending requires explicit confirmation and a 2–20T integer ceiling', () => {
  for (const budgetT of ['1', '21', '2.5', '', '5;exit']) assert.throws(() => approveTest({ ...input, budgetT }));
  assert.throws(() => approveTest({ ...input, confirm: '' }));
  assert.equal(binding.budgetCycles, '5000000000000');
});
test('only governor and large-capacity production environment settings are forwarded', () => {
  assert.deepEqual(environmentFor(binding), [{ name: 'GOVERNOR_PRINCIPAL', value: 'governor' }, { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' }]);
});
test('existing live/group targets are refused, including under matching controller proof', () => {
  const status = { controllers: ['governor'], moduleHash: binding.wasmSha256 };
  assert.throws(() => assertTarget(binding, 'g1-store', status, 'subnet', new Set(['g1-store'])));
  assert.throws(() => assertTarget(binding, 'new', { ...status, controllers: ['governor', 'other'] }, 'subnet', new Set()));
  assert.throws(() => assertTarget(binding, 'new', status, 'foreign', new Set()));
  assert.throws(() => assertTarget(binding, 'new', { ...status, moduleHash: 'b'.repeat(64) }, 'subnet', new Set()));
  assert.doesNotThrow(() => assertTarget(binding, 'new', status, 'subnet', new Set()));
});
test('fuel floor plus call reserve stops further mutations', () => {
  assert.throws(() => assertFuel(binding, FUEL_FLOOR + CALL_RESERVE - 1n, 4_900_000_000_000n));
  assert.doesNotThrow(() => assertFuel(binding, 2_000_000_000_000n, 4_900_000_000_000n));
});
test('unknown mutations and changed bindings cannot be replayed', () => {
  assert.throws(() => assertResume({ binding, pending: { kind: 'create' } }, binding));
  assert.throws(() => assertResume({ binding: { ...binding, runId: 'other' } }, binding));
  assert.doesNotThrow(() => assertResume({ binding }, binding));
});