import { describe, expect, it } from 'vitest';
import { planMediaExpansion, type StoreExpansionEvidence } from './mediaExpansionPolicy';
const e: StoreExpansionEvidence = { storeId: 'store1', groupId: 'g1', expectedGroupId: 'g1', inventoryComplete: true,
  pendingUploads: 0, legacyCount: 57, stableEnabled: false, requestedBytes: 34_359_738_368, measuredCapacityBytes: null, retainedQuotaVerified: false };
describe('same-group storage expansion sequence', () => {
  it('requires the legacy migration before stable writes or larger capacity', () => {
    expect(planMediaExpansion(e).next).toBe('migrate');
    expect(planMediaExpansion({ ...e, legacyCount: 0 }).next).toBe('enable-stable');
    expect(planMediaExpansion({ ...e, legacyCount: 0, stableEnabled: true }).next).toBe('test-capacity');
  });
  it('refuses pending uploads, incomplete inventory and a different group', () => {
    expect(planMediaExpansion({ ...e, pendingUploads: 1 }).next).toBe('blocked');
    expect(planMediaExpansion({ ...e, inventoryComplete: false }).next).toBe('blocked');
    expect(planMediaExpansion({ ...e, groupId: 'g2' }).next).toBe('blocked');
  });
  it('never activates, even with tested 32 GiB and combined allowance proof', () => {
    const tested = { ...e, legacyCount: 0, stableEnabled: true, measuredCapacityBytes: 34_359_738_368 };
    expect(planMediaExpansion(tested).next).toBe('blocked');
    expect(planMediaExpansion({ ...tested, retainedQuotaVerified: true }).next).toBe('approval-required');
    expect(planMediaExpansion({ ...tested, requestedBytes: 34_359_738_369 }).next).toBe('blocked');
  });
});