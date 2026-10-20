import test from 'node:test';
import assert from 'node:assert/strict';
import { approveTest, assertFuel, assertTarget, assertResume, environmentFor, isSmokeScenario, CONFIRM, FUEL_FLOOR, CALL_RESERVE, GiB } from './media-stage-two-policy.mjs';
const input = { runId: 'test-001', scenario: 'mixed', budgetT: '5', confirm: CONFIRM, governor: 'governor', subnetId: 'subnet', wasmSha256: 'a'.repeat(64) };
const binding = approveTest(input);
test('200 GiB smoke configures exactly 200 GiB without entering paid fill or churn', () => {
  assert.equal(approveTest({ ...input, scenario: 'smoke200' }).capacityBytes, 214_748_364_800);
  assert.equal(isSmokeScenario('smoke200'), true);
  assert.equal(isSmokeScenario('smoke'), true);
  assert.equal(isSmokeScenario('mixed'), false);
  assert.equal(isSmokeScenario('tiny'), false);
  assert.throws(() => approveTest({ ...input, scenario: 'smoke64' }), /Unknown test scenario/);
});
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

test('out-of-cycles is a fuel stop, never retried as a busy store', async () => {
  const { isTransientReject, isOutOfCycles } = await import('./media-stage-two-policy.mjs');
  const e = new Error('Reject code: 4 Reject text: IC0207: Canister x is out of cycles Error code: IC0406');
  assert.equal(isOutOfCycles(e), true);
  assert.equal(isTransientReject(e), false);
});

test('uploads are priced at 2,000 cycles per byte plus margin and refused up front when unaffordable', async () => {
  const { uploadCycles, assertAffordable, assertFuel } = await import('./media-stage-two-policy.mjs');
  assert.equal(uploadCycles(GiB), BigInt(GiB) * 2_400n);
  const b = approveTest({ runId: 'media-mixed-001', scenario: 'mixed', budgetT: '5', confirm: CONFIRM, governor: 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae', subnetId: 'e66qm', wasmSha256: 'a'.repeat(64) });
  // The measured state: 1.44T left, ~9.6 GiB still to upload.
  assert.throws(() => assertAffordable(b, 1_437_000_000_000n, 4_400_000_000_000n, 9.6 * GiB), /Not enough fuel/);
  assert.doesNotThrow(() => assertAffordable(b, 4_400_000_000_000n, 4_400_000_000_000n, 0.5 * GiB));
  // A frozen reserve raises the floor even when the raw balance looks fine.
  assert.throws(() => assertFuel(b, 1_437_000_000_000n, 4_400_000_000_000n, 0, 500_000_000_000n), /frozen reserve/);
});

test('tiny run refuses up front when per-object fees cannot be covered (media-tiny-001)', async () => {
  const { assertAffordable } = await import('./media-stage-two-policy.mjs');
  const b = approveTest({ runId: 'media-tiny-002', scenario: 'tiny', budgetT: '3', confirm: CONFIRM, governor: 'aaaaa-aa', subnetId: 's', wasmSha256: 'a'.repeat(64) });
  assert.throws(() => assertAffordable(b, 2_385_000_000_000n, 2_390_000_000_000n, 15 * 1024 ** 2, 71_000_000_000n, 15_000), /Not enough fuel/);
});
