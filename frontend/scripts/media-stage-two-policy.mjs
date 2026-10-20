// Browser-independent safety policy for the dedicated, unregistered network test.
export const GiB = 1024 ** 3;
export const LEDGER_FEE = 100_000_000_000n;
export const FUEL_FLOOR = 1_000_000_000_000n;
export const CALL_RESERVE = 250_000_000_000n;
export const CONFIRM = 'TEST ISOLATED STORE';
export function approveTest({ runId, scenario, budgetT, confirm, governor, subnetId, wasmSha256 }) {
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(runId ?? '')) throw new Error('Use a unique 3–48 character test id');
  if (!['smoke', 'smoke200', 'mixed', 'tiny'].includes(scenario)) throw new Error('Unknown test scenario');
  if (confirm !== CONFIRM) throw new Error('Explicit isolated-store spending confirmation required');
  if (!/^(?:[2-9]|1[0-9]|20)$/.test(String(budgetT))) throw new Error('Approve a whole-number funding ceiling from 2 to 20T cycles');
  if (!governor || governor === '2vxsx-fae' || !subnetId || !/^[a-f0-9]{64}$/.test(wasmSha256)) throw new Error('Complete operator, subnet and build binding required');
  return { version: 1, runId, scenario, governor, subnetId, wasmSha256, network: 'ic', host: 'https://icp-api.io',
    budgetCycles: (BigInt(budgetT) * 1_000_000_000_000n).toString(), capacityBytes: scenario === 'smoke200' ? 200 * GiB : scenario === 'tiny' ? 512 * 1024 ** 2 : 5 * GiB };
}
export function isSmokeScenario(scenario) { return scenario === 'smoke' || scenario === 'smoke200'; }
export function environmentFor(binding) {
  return [{ name: 'GOVERNOR_PRINCIPAL', value: binding.governor }, { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' }];
}
export function assertTarget(binding, id, status, subnet, protectedIds, expectedModule = binding.wasmSha256) {
  if (!id || protectedIds.has(id)) throw new Error('Refusing an existing live/group/test canister');
  if (subnet !== binding.subnetId || status.controllers.length !== 1 || status.controllers[0] !== binding.governor) throw new Error('Exact subnet and sole governor proof required');
  if (status.moduleHash !== expectedModule) throw new Error('Unexpected target module; never reinstall');
}
// Mainnet charges the receiving store per uploaded byte (13-node subnet: 2,000 cycles/byte, ~2.15T per GiB).
// The 20% margin covers hashing/stable-memory execution and per-message fees measured on the mixed run.
export const INGRESS_BYTE_CYCLES = 2_000n;
export function uploadCycles(bytes) { return BigInt(Math.ceil(bytes)) * INGRESS_BYTE_CYCLES * 12n / 10n; }
const T = c => (Number(c) / 1e12).toFixed(2) + 'T';
// freezeReserve: cycles the network keeps untouchable (idle burn × freezing threshold); it grows with stored data.
export function assertFuel(binding, current, initial, nextBytes = 0, freezeReserve = 0n) {
  const next = uploadCycles(nextBytes);
  if (current < FUEL_FLOOR + CALL_RESERVE + freezeReserve + next) throw new Error(`Fuel safety floor reached (${T(current)} left, ${T(freezeReserve)} frozen reserve); no automatic top-up`);
  if (initial - current + CALL_RESERVE + next > BigInt(binding.budgetCycles) - LEDGER_FEE) throw new Error('Approved funding bound reached');
}
// Measured on media-tiny-001 (mainnet): each object costs ~155M cycles in message/execution fees regardless
// of size, and the frozen reserve grows ~89M cycles per stored object (≈115 KiB of memory each).
// Margins of ~30% / ~35% on top.
export const PER_OBJECT_CYCLES = 200_000_000n;
export const PER_OBJECT_RESERVE_CYCLES = 120_000_000n;
// Refuse up front when the remaining uploads cannot be paid for, instead of spending fuel and stopping mid-way.
export function assertAffordable(binding, current, initial, remainingBytes, freezeReserve = 0n, remainingObjects = 0) {
  const objects = BigInt(Math.max(0, Math.ceil(remainingObjects)));
  const spend = uploadCycles(remainingBytes) + objects * PER_OBJECT_CYCLES;
  const need = spend + FUEL_FLOOR + CALL_RESERVE + freezeReserve + objects * PER_OBJECT_RESERVE_CYCLES;
  const budgetLeft = BigInt(binding.budgetCycles) - LEDGER_FEE - (initial - current);
  if (need > current || spend + CALL_RESERVE > budgetLeft)
    throw new Error(`Not enough fuel to finish ${binding.scenario}: remaining uploads (${(remainingBytes / GiB).toFixed(2)} GiB, ${objects} objects) need about ${T(need)} on the store; it holds ${T(current)}. Nothing was uploaded.`);
}
export function isOutOfCycles(error) { return /IC0207|out of cycles/i.test(String(error?.message ?? error)); }
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
    && !isSmokeScenario(binding.scenario);
}
// Rejections raised before the store ran the call (busy queue, failed self-call) change nothing and may be retried.
export function isTransientReject(error) {
  const t = String(error?.message ?? error);
  if (isOutOfCycles(t)) return false; // shares error code IC0406 but is a fuel stop, never "busy"
  return /IC0406|could not perform self call|IC0515|queue (is )?full/i.test(t);
}
