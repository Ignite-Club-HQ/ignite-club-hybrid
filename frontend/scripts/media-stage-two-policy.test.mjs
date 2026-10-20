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
});test('only runs that never reached canister creation may restart under the same id', async () => {
  const { isUnpaidAttempt } = await import('./media-stage-two-policy.mjs');
  const unpaid = { binding, phase: 'approved', pending: null, receipts: [], objects: {}, error: 'Deploy identity lacks approved funding plus ledger fee' };
  assert.equal(isUnpaidAttempt(unpaid), true);
  assert.equal(isUnpaidAttempt({ ...unpaid, phase: 'create' }), false);
  assert.equal(isUnpaidAttempt({ ...unpaid, createdAtNs: '1' }), false);
  assert.equal(isUnpaidAttempt({ ...unpaid, canisterId: 'aaaaa-aa' }), false);
  assert.equal(isUnpaidAttempt({ ...unpaid, pending: { kind: 'create' } }), false);
  assert.equal(isUnpaidAttempt({ ...unpaid, receipts: [{ phase: 'create' }] }), false);
});
test('only a created store stopped inside install may resume', async () => {
  const { isResumableInstall } = await import('./media-stage-two-policy.mjs');
  const s = { binding, phase: 'install', pending: { kind: 'install' }, canisterId: 'abc-cai', objects: {}, receipts: [{ phase: 'create', result: { canisterId: 'abc-cai' } }] };
  assert.equal(isResumableInstall(s, binding), true);
  assert.equal(isResumableInstall({ ...s, phase: 'smoke', pending: { kind: 'smoke' } }, binding), false);
  assert.equal(isResumableInstall({ ...s, receipts: [{ phase: 'create', result: { canisterId: 'other-cai' } }] }, binding), false);
  assert.equal(isResumableInstall({ ...s, binding: { ...binding, budgetCycles: '9' } }, binding), false);
  assert.equal(isResumableInstall({ ...s, pending: { kind: 'create' }, phase: 'create', receipts: [] }, binding), false);
});

test('fill resumes only after every earlier phase is recorded on the same store', async () => {
  const { isResumableFill, isTransientReject } = await import('./media-stage-two-policy.mjs');
  const b = { runId: 'media-mixed-001', scenario: 'mixed' };
  const receipts = ['create', 'install', 'configure-empty', 'smoke'].map(phase => ({ phase, result: phase === 'create' ? { canisterId: 'x-cai' } : {} }));
  const s = { binding: b, phase: 'fill', pending: { kind: 'fill' }, canisterId: 'x-cai', receipts, objects: { a: 1 } };
  assert.equal(isResumableFill(s, b), true);
  assert.equal(isResumableFill({ ...s, receipts: receipts.slice(0, 3) }, b), false);
  assert.equal(isResumableFill({ ...s, phase: 'churn', pending: { kind: 'churn' } }, b), false);
  assert.equal(isResumableFill({ ...s, canisterId: 'y-cai' }, b), false);
  assert.equal(isResumableFill(s, { ...b, budgetCycles: '9' }), false);
  assert.equal(isTransientReject(new Error('Reject code: 4 could not perform self call Error code: IC0406')), true);
  assert.equal(isTransientReject(new Error('Unexpected refusal: NotAuthorized')), false);
});
