const nat = value => {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('Invalid cycle amount');
  return BigInt(value);
};
export function planFuel({ readings, threshold = '1000000000000', target = '3000000000000', ceiling = '0', spent = '0', balance = '0', fee = '0' }) {
  const low = nat(threshold), goal = nat(target), cap = nat(ceiling), used = nat(spent), available = nat(balance), cost = nat(fee);
  if (goal < low || !Array.isArray(readings) || !readings.length) throw new Error('Incomplete fuel evidence');
  const seen = new Set();
  const topups = readings.flatMap(r => {
    if (!r.id || seen.has(r.id)) throw new Error('Missing or duplicate canister');
    seen.add(r.id);
    const cycles = nat(r.cycles);
    return cycles < low ? [{ ...r, amount: String(goal - cycles) }] : [];
  });
  const total = topups.reduce((n, r) => n + nat(r.amount) + cost, 0n);
  return { topups, total: String(total), fee: String(cost), allowed: cap > 0n && used + total <= cap && total <= available };
}
export async function executeFuel({ plan, state, save, transfer }) {
  if (!plan.allowed) return;
  if (state.phase !== 'planned') throw new Error('Unresolved or replayed fuel intent');
  // Reserve the entire cost before any withdrawal; failures never release budget.
  state.phase = 'deposit-intent'; state.reserved = plan.total; await save(state);
  for (const row of plan.topups) {
    state.pending = row.id; await save(state);
    await transfer(row.id, row.amount);
    (state.completed ??= []).push(row.id); delete state.pending; await save(state);
  }
  state.phase = 'complete'; await save(state);
}
