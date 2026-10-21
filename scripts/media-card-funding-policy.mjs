export const DEPLOY_PRINCIPAL = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
export function fundingPlan({ paymentId, testId, scenario, budgetT, confirm, principal, balance }) {
  for (const id of [paymentId, testId]) {
    if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(id ?? '')) throw new Error('Use unique 3–48 character payment and test IDs');
  }
  if (!['smoke', 'mixed', 'tiny'].includes(scenario)) throw new Error('Unknown test scenario');
  if (!/^(?:[2-9]|1[0-9]|20)$/.test(String(budgetT))) throw new Error('Choose the same 2–20T ceiling as the test');
  if (confirm !== 'CREATE CARD LINK') throw new Error('Explicit card-link confirmation required');
  if (principal !== DEPLOY_PRINCIPAL) throw new Error('Wrong deploy identity; no card order created');
  const current = BigInt(balance);
  if (current < 0n) throw new Error('Invalid balance');
  const target = BigInt(budgetT) * 1_000_000_000_000n;
  return { paymentId, testId, scenario, principal, targetCycles: target.toString(),
    balanceBefore: current.toString(), shortfallCycles: (target > current ? target - current : 0n).toString() };
}
export function parseBalance(result) {
  const value = JSON.parse(result).balance;
  if (typeof value !== 'string' || !/^\d[\d_]*(?: cycles)?$/.test(value)) throw new Error('Unexpected cycles balance format');
  return BigInt(value.replace(/ cycles$/, '').replaceAll('_', ''));
}
export function assertNoOpenPayment(records) {
  if (records.some((r) => r.phase !== 'abandoned' && (!['delivered', 'already-funded', 'topups-complete'].includes(r.phase) || (r.plan?.purpose === 'top-ups' && !r.topupsComplete)))) {
    throw new Error('An earlier payment is unresolved. Use its saved link/status; do not create another order.');
  }
}