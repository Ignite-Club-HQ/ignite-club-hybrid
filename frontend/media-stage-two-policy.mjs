// Created and verified, then stopped inside install (no code written or exact build present).
// Only this exact shape may resume; every other interrupted state needs operator reconciliation.
export function isResumableInstall(saved, binding) {
  if (!saved || JSON.stringify(saved.binding) !== JSON.stringify(binding)) return false;
  const receipts = saved.receipts ?? [];
  return saved.phase === 'install' && saved.pending?.kind === 'install' && typeof saved.canisterId === 'string'
    && receipts.length === 1 && receipts[0].phase === 'create' && receipts[0].result?.canisterId === saved.canisterId
    && !Object.keys(saved.objects ?? {}).length;
}
