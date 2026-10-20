import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingPlan, parseBalance, assertNoOpenPayment, DEPLOY_PRINCIPAL } from './media-card-funding-policy.mjs';
const input = { paymentId: 'card-smoke-001', testId: 'media-smoke-004', scenario: 'smoke', budgetT: '5',
  confirm: 'CREATE CARD LINK', principal: DEPLOY_PRINCIPAL, balance: 24_422_920_000n };
test('5T test target includes its existing fee and buys only the exact balance shortfall', () => {
  assert.equal(fundingPlan(input).targetCycles, '5000000000000');
  assert.equal(fundingPlan(input).shortfallCycles, '4975577080000');
});
test('all three tests use the selected ceiling, not a guessed consumption estimate', () => {
  for (const scenario of ['smoke', 'mixed', 'tiny']) {
    assert.equal(fundingPlan({ ...input, scenario, budgetT: '2', balance: 1_000_000_000_000n }).shortfallCycles, '1000000000000');
  }
});
test('sufficient funding creates no shortfall', () => {
  assert.equal(fundingPlan({ ...input, balance: 6_000_000_000_000n }).shortfallCycles, '0');
});
test('wrong identity and unconfirmed requests cannot create card orders', () => {
  assert.throws(() => fundingPlan({ ...input, principal: '2vxsx-fae' }), /Wrong deploy identity/);
  assert.throws(() => fundingPlan({ ...input, confirm: '' }), /confirmation/);
});
test('balance parser handles the CLI output without changing payment links', () => {
  assert.equal(parseBalance('{"balance":"24_422_920_000 cycles"}'), 24_422_920_000n);
  assert.throws(() => parseBalance('{"balance":"unknown"}'), /Unexpected/);
});
test('unresolved or lost orders block every further purchase', () => {
  for (const phase of ['creating-order', 'checkout-ready', 'processing', 'needs_review', 'refunded']) {
    assert.throws(() => assertNoOpenPayment([{ phase }]), /unresolved/);
  }
  assert.doesNotThrow(() => assertNoOpenPayment([{ phase: 'delivered' }, { phase: 'already-funded' }]));
});