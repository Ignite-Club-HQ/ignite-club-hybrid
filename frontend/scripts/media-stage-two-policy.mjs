// Browser-independent safety policy for the dedicated, unregistered network test.
export const GiB = 1024 ** 3;
export const LEDGER_FEE = 100_000_000_000n;
export const FUEL_FLOOR = 1_000_000_000_000n;
export const CALL_RESERVE = 250_000_000_000n;
export const CONFIRM = 'TEST ISOLATED STORE';
export function approveTest({ runId, scenario, budgetT, confirm, governor, subnetId, wasmSha256 }) {
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(runId ?? '')) throw new Error('Use a unique 3–48 character test id');
  if (!['smoke', 'mixed', 'tiny'].includes(scenario)) throw new Error('Unknown test scenario');
  if (confirm !== CONFIRM) throw new Error('Explicit isolated-store spending confirmation required');
  if (!/^(?:[2-9]|1[0-9]|20)$/.test(String(budgetT))) throw new Error('Approve a whole-number funding ceiling from 2 to 20T cycles');
  if (!governor || governor === '2vxsx-fae' || !subnetId || !/^[a-f0-9]{64}$/.test(wasmSha256)) throw new Error('Complete operator, subnet and build binding required');
  return { version: 1, runId, scenario, governor, subnetId, wasmSha256, network: 'ic', host: 'https://icp-api.io',
    budgetCycles: (BigInt(budgetT) * 1_000_000_000_000n).toString(), capacityBytes: scenario === 'tiny' ? 512 * 1024 ** 2 : 5 * GiB };
}
export function environmentFor(binding) {
  return [{ name: 'GOVERNOR_PRINCIPAL', value: binding.governor }, { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' }];
}
export function assertTarget(binding, id, status, subnet, protectedIds, expectedModule = binding.wasmSha256) {
  if (!id || protectedIds.has(id)) throw new Error('Refusing an existing live/group/test canister');
  if (subnet !== binding.subnetId || status.controllers.length !== 1 || status.controllers[0] !== binding.governor) throw new Error('Exact subnet and sole governor proof required');
  if (status.moduleHash !== expectedModule) throw new Error('Unexpected target module; never reinstall');
}
export function assertFuel(binding, current, initial) {
  if (current < FUEL_FLOOR + CALL_RESERVE) throw new Error('Fuel safety floor reached; no automatic top-up');
  if (initial - current + CALL_RESERVE > BigInt(binding.budgetCycles) - LEDGER_FEE) throw new Error('Approved funding bound reached');
}
export function assertResume(saved, binding) {
  if (JSON.stringify(saved.binding) !== JSON.stringify(binding)) throw new Error('Saved test binding differs');
  if (saved.pending) throw new Error('Unresolved mutation: report and reconcile; never automatically repeat');
}// A saved run that stopped before the create phase started never spent cycles or created a canister,
// so it may be restarted under the same id (e.g. after funding the deploy account).
export function isUnpaidAttempt(saved) {
  return saved?.phase === 'approved' && !saved.pending && !saved.canisterId && !saved.createdAtNs
    && !(saved.receipts?.length) && !Object.keys(saved.objects ?? {}).length;
}
// Created and verified, then stopped inside install (no code written or exact build present).
// Only this exact shape may resume; every other interrupted state needs operator reconciliation.
export function isResumableInstall(saved, binding) {
  if (!saved || JSON.stringify(saved.binding) !== JSON.stringify(binding)) return false;
  const receipts = saved.receipts ?? [];
  return saved.phase === 'install' && saved.pending?.kind === 'install' && typeof saved.canisterId === 'string'
    && receipts.length === 1 && receipts[0].phase === 'create' && receipts[0].result?.canisterId === saved.canisterId
    && !Object.keys(saved.objects ?? {}).length;
}

// Stopped inside fill after create/install/configure/smoke were all recorded. Fill writes only
// deterministic test paths, so a resume re-reads every path's hash from the store itself and
// refuses to continue unless the store's own byte total matches that reconciliation exactly.
export function isResumableFill(saved, binding) {
  if (!saved || JSON.stringify(saved.binding) !== JSON.stringify(binding)) return false;
  const phases = (saved.receipts ?? []).map(r => r.phase).join(',');
  return saved.phase === 'fill' && saved.pending?.kind === 'fill' && typeof saved.canisterId === 'string'
    && phases === 'create,install,configure-empty,smoke' && saved.receipts[0].result?.canisterId === saved.canisterId
    && binding.scenario !== 'smoke';
}
// Rejections raised before the store ran the call (busy queue, failed self-call) change nothing and may be retried.
export function isTransientReject(error) {
  const t = String(error?.message ?? error);
  return /IC0406|could not perform self call|IC0515|queue (is )?full/i.test(t);
}
