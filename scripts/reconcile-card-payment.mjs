// Closes ONE stuck card order the operator confirms was paid. Never buys, never transfers.
import { appendFileSync } from 'node:fs';
import { createJournalApi } from '../frontend/scripts/media-stage-two-github.mjs';
import { DEPLOY_PRINCIPAL } from './media-card-funding-policy.mjs';
import { statusEvidence } from './infrastructure-card-funding-policy.mjs';

export function reconcileDecision({ records, orderId, confirm, principal, balance, abandon = false }) {
  if (abandon ? confirm !== 'ABANDON THIS ORDER' : confirm !== 'I PAID THIS ORDER') throw new Error(abandon ? 'Type ABANDON THIS ORDER' : 'Type I PAID THIS ORDER to reconcile');
  if (principal !== DEPLOY_PRINCIPAL) throw new Error('Wrong deploy identity');
  if (!/^co-[a-z0-9-]{8,64}$/.test(orderId ?? '')) throw new Error('Enter the Order co-... ID from the stuck run log');
  const matches = records.filter(r => r.data.order?.order_id === orderId);
  if (matches.length !== 1) throw new Error('No single saved record holds that order');
  const { path, data } = matches[0];
  if (data.phase !== 'checkout-ready') throw new Error(`Order is in phase ${data.phase}; only checkout-ready orders can be reconciled`);
  if (data.transfers?.length) throw new Error('Transfer evidence exists; manual review required');
  if (abandon) return { path, data: { ...data, phase: 'abandoned', abandoned: { at: new Date().toISOString(),
    balanceAtClose: String(balance), note: 'Operator closed this unpaid/undelivered order. Any late delivery stays in the deploy account; no top-ups were applied.' } } };
  const before = BigInt(data.plan?.balanceBefore ?? '-1');
  if (before < 0n || BigInt(balance) <= before) throw new Error(`Deploy balance ${balance} has not risen above ${data.plan?.balanceBefore}; delivery not evidenced`);
  return { path, data: { ...data, phase: 'delivered', topupsComplete: true, reconciled: {
    at: new Date().toISOString(), balanceAfter: String(balance), note: 'Operator-confirmed payment; no top-ups applied by this order. Run a fresh top-up.' } } };
}

// Closes a delivered top-up order whose transfer loop stopped part-way. Every transfer with an
// unconfirmed outcome must show a clear on-chain fuel rise; otherwise it stays fenced (no replay).
// Remaining canisters are NOT topped up here — a fresh top-up run plans them from live readings.
export function finishInterruptedDecision({ records, paymentId, confirm, principal, liveCycles }) {
  if (confirm !== 'CLOSE INTERRUPTED TOPUP') throw new Error('Type CLOSE INTERRUPTED TOPUP');
  if (principal !== DEPLOY_PRINCIPAL) throw new Error('Wrong deploy identity');
  const matches = records.filter(r => r.data.plan?.paymentId === paymentId || (paymentId && r.data.order?.order_id === paymentId));
  if (matches.length !== 1) throw new Error('No single saved record matches that payment ID');
  const { path, data } = matches[0];
  if (data.plan?.purpose !== 'top-ups' || data.topupsComplete) throw new Error('Not an unfinished top-up record');
  if (!['transferring', 'transfer-confirmed', 'delivered'].includes(data.phase)) throw new Error(`Record is in phase ${data.phase}; only delivered/interrupted top-ups can be closed this way`);
  const transfers = (data.transfers ?? []).map(t => {
    if (t.phase === 'verified') return t;
    const now = BigInt(liveCycles(t.id));
    // The CLI call failed and no fuel arrived: record it as not applied so a fresh run plans it again.
    // A late landing would only over-fuel one canister; fuel stays in that canister, nothing is lost.
    if (now < BigInt(t.beforeCycles) + BigInt(t.amount) / 2n) return { ...t, phase: 'not-applied', observedCycles: now.toString() };
    return { ...t, phase: 'verified', afterCycles: now.toString(), verifiedAt: 'finish-interrupted' };
  });
  const done = new Set(transfers.filter(t => t.phase === 'verified').map(t => t.id));
  const remaining = (data.plan.topups ?? []).filter(t => !done.has(t.id)).map(t => t.name);
  return { path, remaining, data: { ...data, transfers, phase: 'topups-complete', topupsComplete: true, closedInterrupted: {
    at: new Date().toISOString(), remaining, note: 'Interrupted top-up closed after on-chain verification. Remaining canisters need a fresh top-up run.' } } };
}

export async function reconcilePaidOrder({ cli, identity, balance, abandon = false, finish = false }) {
  const api = createJournalApi(process.env.GITHUB_REPOSITORY, JSON.stringify);
  const branch = 'ignite-media-test-receipts';
  const read = path => {
    const entry = api(`contents/${path}?ref=${branch}`);
    return { sha: entry.sha, text: Buffer.from(api(`git/blobs/${entry.sha}`).content, 'base64').toString() };
  };
  const tree = api(`git/trees/${branch}?recursive=1`);
  if (tree.truncated) throw new Error('Incomplete funding inventory');
  const records = tree.tree.filter(e => /^deploy\/media-funding\/[^/]+\.json$/.test(e.path)).map(e => ({ path: e.path, data: JSON.parse(read(e.path).text) }));
  const principal = cli(['identity', 'principal', '--identity', identity]);
  const decision = finish
    ? finishInterruptedDecision({ records, paymentId: process.env.PAYMENT_ID, confirm: process.env.CARD_CONFIRM, principal,
      liveCycles: id => statusEvidence(cli(['canister', 'status', id, '-n', 'ic', '--identity', identity, '--json']), id).cycles })
    : reconcileDecision({ records, orderId: process.env.PAYMENT_ID, confirm: process.env.CARD_CONFIRM, principal, balance: balance().toString(), abandon });
  const { path, data } = decision;
  const label = finish ? 'Closed interrupted top-up' : abandon ? 'Abandoned' : 'Reconciled';
  const text = JSON.stringify(data, null, 2) + '\n';
  api(`contents/${path}`, 'PUT', { message: `${label} ${process.env.PAYMENT_ID}`, branch,
    content: Buffer.from(text).toString('base64'), sha: read(path).sha });
  if (read(path).text !== text) throw new Error('Reconcile read-back mismatch');
  const extra = finish ? ` Still below target: ${decision.remaining.join(', ') || 'none'}.` : '';
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${label} ${path}.${extra} Now run a fresh top-up with a new payment ID; it uses deploy-account fuel before asking for a card.\n`);
  console.log(`${label} ${path}.${extra}`);
}
