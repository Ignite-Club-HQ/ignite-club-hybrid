import { describe, expect, it, vi } from 'vitest';
import { createMediaOperatorRegistry, type MediaRegistryPlacement } from './mediaOperatorRegistry';
function fixture() {
  const p: MediaRegistryPlacement = { revision: '7', deploymentId: 'd', host: 'https://icp-api.io', complete: true,
    stores: [{ canisterId: 's', quotaAuthority: 'q', subnetId: 'subnet' }], approvedSubnets: ['subnet'] };
  const actor = { read_media_quota_store_registry: vi.fn(async () => ({ Ok: { active: true, stores: [{ toText: () => 's' }] } })) };
  const d = { readPlacement: vi.fn(async () => structuredClone(p)), quotaActor: () => actor, storeActor: () => ({
    club_media_inventory_page: vi.fn(), set_club_media_transfer_fence: vi.fn() }) };
  return { p, actor, d, read: createMediaOperatorRegistry({ deploymentId: 'd', host: 'https://icp-api.io' }, d) };
}
describe('complete consensus media registry', () => {
  it('reads every quota authority twice and binds the store actors', async () => {
    const f = fixture(); const result = await f.read(); expect(result.stores.map(s => s.canisterId)).toEqual(['s']);
    expect(f.actor.read_media_quota_store_registry).toHaveBeenCalledTimes(2); expect(result.revision).toBe('7');
  });
  it('refuses omitted registered stores, including orphan storage', async () => {
    const f = fixture(); f.actor.read_media_quota_store_registry.mockResolvedValue({ Ok: { active: true, stores: [{ toText: () => 's' }, { toText: () => 'orphan-store' }] } });
    await expect(f.read()).rejects.toThrow('differ');
  });
  it('refuses inactive quotas', async () => {
    const f = fixture(); f.actor.read_media_quota_store_registry.mockResolvedValue({ Ok: { active: false, stores: [{ toText: () => 's' }] } });
    await expect(f.read()).rejects.toThrow('differ');
  });
  it.each(['deploymentId', 'host', 'subnet'] as const)('refuses changed %s placement', async key => {
    const f = fixture(); if (key === 'subnet') f.p.stores[0].subnetId = 'unapproved'; else f.p[key] = 'other';
    await expect(f.read()).rejects.toThrow();
  });
  it('refuses revision changes during registry reads', async () => {
    const f = fixture(); f.d.readPlacement.mockResolvedValueOnce(f.p).mockResolvedValueOnce({ ...f.p, revision: '8' });
    await expect(f.read()).rejects.toThrow('changed');
  });
});