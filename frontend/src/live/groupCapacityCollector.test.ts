import { describe, it, expect } from 'vitest';
import { collectGroupCapacity } from './groupCapacityCollector';
import { prepareCapacityRequests } from './groupCapacityPreparation';

const limits = { deploymentId: 'mainnet', groupId: 'g1', subnetId: 's1', clubCount: 3,
  storageLimitBytes: { messaging_domain: 1_000e6, media_blob_store: 1_600e6 } };
const now = 1_800_000_000_000;
const policy = { deploymentId: 'mainnet', primarySubnet: 's1', additionalSubnetsEnabled: false,
  approvedSubnets: ['s1'], currentGroupId: 'g1', nowMs: now };

describe('capacity collector', () => {
  it('missing memory reading writes no evidence', () => {
    const r = collectGroupCapacity([{ name: 'messaging_domain', memory_mb: 10, cycles_t: 5 }], limits, now);
    expect(r.group).toBeNull();
  });
  it('70% of the tightest tested limit queues one closed request', () => {
    const { group } = collectGroupCapacity([
      { name: 'messaging_domain', memory_mb: 700, cycles_t: 5 },
      { name: 'media_blob_store', memory_mb: 100, cycles_t: 5 }], limits, now);
    expect(prepareCapacityRequests([group!], policy).requests).toHaveLength(1);
  });
  it('69% queues nothing', () => {
    const { group } = collectGroupCapacity([
      { name: 'messaging_domain', memory_mb: 690, cycles_t: 5 },
      { name: 'media_blob_store', memory_mb: 100, cycles_t: 5 }], limits, now);
    expect(prepareCapacityRequests([group!], policy).requests).toHaveLength(0);
  });
  it('low fuel blocks with a top-up message, not a new group', () => {
    const { group } = collectGroupCapacity([
      { name: 'messaging_domain', memory_mb: 900, cycles_t: 0.4 },
      { name: 'media_blob_store', memory_mb: 100, cycles_t: 5 }], limits, now);
    expect(prepareCapacityRequests([group!], policy).blocked[0]).toMatch(/Top up/);
  });
});
