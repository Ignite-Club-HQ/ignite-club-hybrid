// Closes ONE stuck card order the operator confirms was paid. Never buys, never transfers.
import { appendFileSync } from 'node:fs';
import { createJournalApi } from '../frontend/scripts/media-stage-two-github.mjs';
import { DEPLOY_PRINCIPAL } from './media-card-funding-policy.mjs';

export function reconcileDecision({ records, orderId, confirm, principal, balance }) {
  if (confirm !== 'I PAID THIS ORDER') throw new Error('Type I PAID THIS ORDER to reconcile');
  if (principal !== DEPLOY_PRINCIPAL) throw new Error('Wrong deploy identity');
  if (!/^co-[a-z0-9-]{8,64}$/.test(orderId ?? '')) throw new Error('Enter the Order co-... ID from the stuck run log');
  const matches = records.filter(r => r.data.order?.order_id === orderId);
  if (matches.length !== 1) throw new Error('No single saved record holds that order');
  const { path, data } = matches[0];
  if (data.phase !== 'checkout-ready') throw new Error(`Order is in phase ${data.phase}; only checkout-ready orders can be reconciled`);
  if (data.transfers?.length) throw new Error('Transfer evidence exists; manual review required');
  const before = BigInt(data.plan?.balanceBefore ?? '-1');
  if (before < 0n || BigInt(balance) <= before) throw new Error(`Deploy balance ${balance} has not risen above ${data.plan?.balanceBefore}; delivery not evidenced`);
  return { path, data: { ...data, phase: 'delivered', topupsComplete: true, reconciled: {
    at: new Date().toISOString(), balanceAfter: String(balance), note: 'Operator-confirmed payment; no top-ups applied by this order. Run a fresh top-up.' } } };
}

export async function reconcilePaidOrder({ cli, identity, balance }) {
  const api = createJournalApi(process.env.GITHUB_REPOSITORY, JSON.stringify);
  const branch = 'ignite-media-test-receipts';
  const read = path => {
    const entry = api(`contents/${path}?ref=${branch}`);
    return { sha: entry.sha, text: Buffer.from(api(`git/blobs/${entry.sha}`).content, 'base64').toString() };
  };
  const tree = api(`git/trees/${branch}?recursive=1`);
  if (tree.truncated) throw new Error('Incomplete funding inventory');
  const records = tree.tree.filter(e => /^deploy\/media-funding\/[^/]+\.json$/.test(e.path)).map(e => ({ path: e.path, data: JSON.parse(read(e.path).text) }));
  const { path, data } = reconcileDecision({ records, orderId: process.env.PAYMENT_ID, confirm: process.env.CARD_CONFIRM,
    principal: cli(['identity', 'principal', '--identity', identity]), balance: balance().toString() });
  const text = JSON.stringify(data, null, 2) + '\n';
  api(`contents/${path}`, 'PUT', { message: `Reconcile paid order ${process.env.PAYMENT_ID}`, branch,
    content: Buffer.from(text).toString('base64'), sha: read(path).sha });
  if (read(path).text !== text) throw new Error('Reconcile read-back mismatch');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Reconciled ${path}: deploy balance ${data.reconciled.balanceAfter} cycles. Now run a fresh top-up with a new payment ID; it uses this fuel before asking for a card.\n`);
  console.log(`Reconciled ${path}; balance ${data.reconciled.balanceAfter}`);
}
