/** Evidence-only same-group expansion plan. Never changes flags or URLs. */
export type StoreExpansionEvidence = {
  storeId: string; groupId: string; expectedGroupId: string;
  inventoryComplete: boolean; pendingUploads: number; legacyCount: number;
  stableEnabled: boolean; requestedBytes: number;
  measuredCapacityBytes: number | null; retainedQuotaVerified: boolean;
};
export function planMediaExpansion(e: StoreExpansionEvidence): { next: 'blocked' | 'migrate' | 'enable-stable' | 'test-capacity' | 'approval-required'; problems: string[] } {
  const problems: string[] = [];
  if (!e.storeId || !e.groupId || e.groupId !== e.expectedGroupId) problems.push('Store must remain in its original group');
  if (!e.inventoryComplete) problems.push('Complete authenticated store inventory required');
  if (!Number.isSafeInteger(e.pendingUploads) || e.pendingUploads !== 0) problems.push('Drain and reconcile uploads');
  if (!Number.isSafeInteger(e.legacyCount) || e.legacyCount < 0) problems.push('Legacy inventory unknown');
  if (!Number.isSafeInteger(e.requestedBytes) || e.requestedBytes <= 0 || e.requestedBytes > 34_359_738_368) problems.push('Capacity outside supported 32 GiB ceiling');
  if (problems.length) return { next: 'blocked', problems };
  if (e.legacyCount > 0) return { next: 'migrate', problems: [] };
  if (!e.stableEnabled) return { next: 'enable-stable', problems: [] };
  if (e.measuredCapacityBytes === null || !Number.isSafeInteger(e.measuredCapacityBytes) || e.measuredCapacityBytes < e.requestedBytes) return { next: 'test-capacity', problems: [] };
  if (!e.retainedQuotaVerified) return { next: 'blocked', problems: ['Combined retained quota acceptance required'] };
  return { next: 'approval-required', problems: [] };
}