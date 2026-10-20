import test from 'node:test';
import assert from 'node:assert/strict';
import { infrastructurePlan, statusEvidence, applyTopups, T } from './infrastructure-card-funding-policy.mjs';
import { DEPLOY_PRINCIPAL, assertNoOpenPayment } from './media-card-funding-policy.mjs';
const base = { paymentId: 'card-topup-001', purpose: 'top-ups', groupId: 'g1', principal: DEPLOY_PRINCIPAL,
  confirm: 'CREATE CARD LINK', balance: 0n, targetT: '3', fee: 100_000_000n,
  readings: [{ name: 'media', id: 'one', cycles: '400000000000' }, { name: 'healthy', id: 'two', cycles: '1100000000000' }] };
test('top-ups select low fuel only and include live fees minus deploy balance', () => {
  const p = infrastructurePlan({ ...base, balance: T });
  assert.equal(p.topups.length, 1);
  assert.equal(p.topups[0].amount, '2600000000000');
  assert.equal(p.targetCycles, '2600100000000');
  assert.equal(p.shortfallCycles, '1600100000000');
  assert.equal(infrastructurePlan({ ...base, readings: [{ id: 'a', cycles: T.toString() }] }).targetCycles, '0');
});
test('new group funds exactly 13 installer defaults including creation fees, without creating anything', () => {
  const p = infrastructurePlan({ ...base, purpose: 'new-group', groupId: 'g2', balance: T });
  assert.equal(p.targetCycles, '20800000000000');
  assert.equal(p.shortfallCycles, '19800000000000');
  assert.deepEqual(p.topups, []);
  assert.throws(() => infrastructurePlan({ ...base, purpose: 'new-group' }), /genuinely new/);
  assert.throws(() => infrastructurePlan({ ...base, purpose: 'new-group', groupId: 'g2', existingGroup: true }), /genuinely new/);
});
test('wrong identity, unconfirmed, duplicate and unreadable readings fail closed', () => {
  assert.throws(() => infrastructurePlan({ ...base, confirm: '' }));
  assert.throws(() => infrastructurePlan({ ...base, principal: '2vxsx-fae' }));
  assert.throws(() => infrastructurePlan({ ...base, readings: [] }));
  assert.throws(() => infrastructurePlan({ ...base, readings: [base.readings[0], base.readings[0]] }));
  assert.throws(() => infrastructurePlan({ ...base, targetT: '20.001' }));
  const status = { id: 'one', cycles: '400_000_000_000', settings: { controllers: [DEPLOY_PRINCIPAL] }, reserved_cycles: '5000000000000' };
  assert.equal(statusEvidence(JSON.stringify(status), 'one').cycles, '400000000000');
  assert.throws(() => statusEvidence(JSON.stringify({ ...status, cycles: undefined }), 'one'));
  assert.throws(() => statusEvidence(JSON.stringify(status), 'foreign'));
});
test('transfer intent is durable before deposit, verified afterwards and unknown replies never replay', async () => {
  const plan = infrastructurePlan(base), state = {}; const events = []; let topped = false;
  const args = { plan, state, save: () => events.push(state.phase), balance: () => BigInt(plan.targetCycles),
    status: () => ({ cycles: topped ? '2999990000000' : '399990000000' }),
    transfer: (id, amount) => { assert.equal(events.at(-1), 'transferring'); assert.equal(amount, '2600000000000'); topped = true; } };
  await applyTopups(args);
  assert.equal(state.phase, 'topups-complete');
  assert.equal(state.transfers[0].phase, 'verified');
  assert.doesNotThrow(() => assertNoOpenPayment([{ plan, ...state }]));
  await assert.rejects(() => applyTopups(args), /reconciliation/);
  const unknown = {};
  await assert.rejects(() => applyTopups({ ...args, state: unknown, transfer: () => { throw Error('reply lost'); } }), /reply lost/);
  assert.equal(unknown.phase, 'transferring');
  assert.throws(() => assertNoOpenPayment([{ plan, ...unknown }]), /unresolved/);
  assert.throws(() => assertNoOpenPayment([{ plan, phase: 'delivered' }]), /unresolved/);
});
test('insufficient delivered balance starts no transfers', async () => {
  let calls = 0;
  await assert.rejects(() => applyTopups({ plan: infrastructurePlan(base), state: {}, save: () => {}, balance: () => 0n, transfer: () => calls++ }), /short/);
  assert.equal(calls, 0);
});