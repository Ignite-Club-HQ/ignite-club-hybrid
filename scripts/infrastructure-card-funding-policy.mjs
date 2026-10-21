import { DEPLOY_PRINCIPAL } from './media-card-funding-policy.mjs';
export const GROUP_SERVICES = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain', 'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs'];
export const T = 1_000_000_000_000n;
export function cyclesAmount(value) {
  if (!/^(?:[1-9]|1[0-9]|20)(?:\.\d{1,3})?$/.test(String(value))) throw new Error('Choose 1–20T with at most three decimal places');
  const [whole, fraction = ''] = String(value).split('.');
  const result = BigInt(whole) * T + BigInt(fraction.padEnd(12, '0'));
  if (result > 20n * T) throw new Error('Maximum 20T');
  return result;
}
export function statusEvidence(text, id) {
  const r = JSON.parse(text);
  if (r.id !== id || !r.settings?.controllers?.includes(DEPLOY_PRINCIPAL) || typeof r.cycles !== 'string' || !/^\d[\d_]*$/.test(r.cycles)) throw new Error('Missing actual fuel/controller evidence; no top-up allowed');
  return { id, cycles: BigInt(r.cycles.replaceAll('_', '')).toString() };
}
export function infrastructurePlan({ paymentId, purpose, groupId, principal, confirm, balance, readings = [], targetT = '3', fee = 0n, existingGroup = false }) {
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(paymentId ?? '')) throw new Error('Unique 3–48 character payment ID required: lowercase letters, digits and hyphens only, starting with a letter or digit (e.g. g2-topup-20261021-02)');
  if (principal !== DEPLOY_PRINCIPAL || confirm !== 'CREATE CARD LINK') throw new Error('Existing deploy identity and explicit confirmation required');
  if (!/^g[0-9]{1,3}$/.test(groupId ?? '')) throw new Error('Group must look like g1 or g2');
  const current = BigInt(balance);
  if (current < 0n || BigInt(fee) < 0n) throw new Error('Invalid balance or fee');
  let target, topups = [];
  if (purpose === 'new-group') {
    if (groupId === 'g1' || existingGroup) throw new Error('Use a genuinely new group; existing installs need manual reconciliation');
    // Same default as closed installer: 13 × (1.5T initial fuel + 0.1T creation fee).
    target = 13n * (1_500_000_000_000n + 100_000_000_000n);
  } else if (purpose === 'top-ups') {
    const ceiling = cyclesAmount(targetT);
    if (readings.length === 0 || new Set(readings.map(r => r.id)).size !== readings.length) throw new Error('Complete unique canister readings required');
    topups = readings.filter(r => BigInt(r.cycles) < T).map(r => ({ ...r, amount: (ceiling - BigInt(r.cycles)).toString() }));
    target = topups.reduce((n, r) => n + BigInt(r.amount) + BigInt(fee), 0n);
  } else throw new Error('Unknown funding purpose');
  return { paymentId, purpose, groupId, principal, scenario: purpose, testId: groupId,
    targetCycles: target.toString(), balanceBefore: current.toString(), shortfallCycles: (target > current ? target - current : 0n).toString(),
    topups, feeCycles: BigInt(fee).toString(), targetT: purpose === 'top-ups' ? targetT : undefined };
}
export async function applyTopups({ plan, state, save, balance, status, transfer }) {
  if (state.transfers?.length) throw new Error('Existing transfer evidence requires reconciliation, never replay');
  if (BigInt(await balance()) < BigInt(plan.targetCycles)) throw new Error('Delivered balance is short; no canister transfers started');
  state.transfers = [];
  for (const target of plan.topups) {
    const before = await status(target.id);
    if (BigInt(before.cycles) >= cyclesAmount(plan.targetT)) continue;
    if (BigInt(await balance()) < BigInt(target.amount) + BigInt(plan.feeCycles)) throw new Error('Balance short before top-up');
    const receipt = { id: target.id, name: target.name, amount: target.amount, beforeCycles: before.cycles, phase: 'transferring' };
    state.transfers.push(receipt); state.phase = 'transferring'; await save();
    // CLI withdrawal has no dedup timestamp: a lost reply MUST remain fenced.
    await transfer(target.id, target.amount);
    receipt.phase = 'transfer-confirmed'; await save();
    const after = await status(target.id);
    receipt.afterCycles = after.cycles;
    if (BigInt(after.cycles) <= BigInt(before.cycles)) throw new Error('Fuel increase unverified; do not repeat transfer');
    receipt.phase = 'verified'; await save();
  }
  state.topupsComplete = true; state.phase = 'topups-complete'; await save();
}