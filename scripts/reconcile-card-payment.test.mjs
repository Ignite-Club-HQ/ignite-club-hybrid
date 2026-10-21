import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDecision } from './reconcile-card-payment.mjs';
import { DEPLOY_PRINCIPAL } from './media-card-funding-policy.mjs';
const rec = (phase = 'checkout-ready') => [{ path: 'deploy/media-funding/x.json', data: { phase, plan: { balanceBefore: '100', purpose: 'top-ups' }, order: { order_id: 'co-46-abcdef12' } } }];
const base = { orderId: 'co-46-abcdef12', confirm: 'I PAID THIS ORDER', principal: DEPLOY_PRINCIPAL };
test('closes a paid order when balance rose', () => {
  const r = reconcileDecision({ ...base, records: rec(), balance: '500' });
  assert.equal(r.data.phase, 'delivered'); assert.equal(r.data.topupsComplete, true);
});
test('refuses without balance increase', () => assert.throws(() => reconcileDecision({ ...base, records: rec(), balance: '100' })));
test('refuses wrong confirmation', () => assert.throws(() => reconcileDecision({ ...base, confirm: 'yes', records: rec(), balance: '500' })));
test('refuses orders not awaiting checkout', () => assert.throws(() => reconcileDecision({ ...base, records: rec('transferring'), balance: '500' })));
test('abandons a checkout-ready order without balance evidence', () => {
  const r = reconcileDecision({ ...base, confirm: 'ABANDON THIS ORDER', abandon: true, records: rec(), balance: '1' });
  assert.equal(r.data.phase, 'abandoned');
});
test('abandoned orders no longer block new payments', async () => {
  const { assertNoOpenPayment } = await import('./media-card-funding-policy.mjs');
  assert.doesNotThrow(() => assertNoOpenPayment([{ phase: 'abandoned', plan: { purpose: 'top-ups' } }]));
  assert.throws(() => assertNoOpenPayment([{ phase: 'checkout-ready', plan: { purpose: 'top-ups' } }]));
});
test('closes an interrupted top-up after on-chain verification', async () => {
  const { finishInterruptedDecision } = await import('./reconcile-card-payment.mjs');
  const records = [{ path: 'p', data: { phase: 'transferring', plan: { paymentId: 'g2-topup-x', purpose: 'top-ups',
    topups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] },
    transfers: [{ id: 'a', name: 'A', phase: 'verified', beforeCycles: '980', amount: '520' }, { id: 'b', name: 'B', phase: 'transferring', beforeCycles: '980', amount: '520' }] } }];
  const args = { records, paymentId: 'g2-topup-x', confirm: 'CLOSE INTERRUPTED TOPUP', principal: DEPLOY_PRINCIPAL };
  const r = finishInterruptedDecision({ ...args, liveCycles: () => '1500' });
  assert.equal(r.data.topupsComplete, true); assert.deepEqual(r.remaining, ['C']);
  const { assertNoOpenPayment } = await import('./media-card-funding-policy.mjs');
  assert.doesNotThrow(() => assertNoOpenPayment([r.data]));
  const unapplied = finishInterruptedDecision({ ...args, liveCycles: () => '990' });
  assert.equal(unapplied.data.transfers[1].phase, 'not-applied'); assert.deepEqual(unapplied.remaining, ['B', 'C']);
  assert.throws(() => finishInterruptedDecision({ ...args, confirm: 'yes', liveCycles: () => '1500' }));
  assert.throws(() => finishInterruptedDecision({ ...args, records: [{ path: 'p', data: { ...records[0].data, phase: 'checkout-ready' } }], liveCycles: () => '1500' }));
});
