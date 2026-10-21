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
