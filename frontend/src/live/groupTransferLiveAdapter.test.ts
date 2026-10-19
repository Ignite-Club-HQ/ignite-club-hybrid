import { describe, it, expect, vi } from 'vitest';
import { liveTransferAdapter, LIVE_DOMAINS, type GroupActors, type LiveAdapterDeps } from './groupTransferLiveAdapter';

function deps(sponsors: string[]) {
  const okR = async () => ({ Ok: null });
  const claim = vi.fn(async () => ({ Ok: null }));
  const actor = { set_transfer_fence: vi.fn(okR), export_club_snapshot: vi.fn(async () => ({ Ok: new Uint8Array([1]) })), import_club_snapshot: vi.fn(okR), purge_club_snapshot: vi.fn(async () => ({ Ok: 0n })) };
  const actors = Object.fromEntries(LIVE_DOMAINS.map(d => [d, { ...actor }])) as unknown as GroupActors;
  Object.assign(actors.club_domain, { freeze_club: vi.fn(async () => ({ Ok: 1n })), unfreeze_club: vi.fn(okR) });
  Object.assign(actors.insights_domain, { claim_legacy_sponsor_metrics: claim });
  const d = { actors: () => actors, clubSponsorIds: vi.fn(async () => sponsors), sameDeployment: vi.fn(), readRegistryRevision: vi.fn(),
    swapAssignment: vi.fn(), save: vi.fn(), fenceRevision: 1n, targetFor: vi.fn(async () => null) } as unknown as LiveAdapterDeps;
  return { d, claim };
}

describe('live move adapter', () => {
  it('refuses moves without an authenticated media reader', async () => {
    const { d } = deps([]);
    await expect(liveTransferAdapter(d).verifyMedia?.('a', 'b', 'club')).rejects.toThrow('inventory reader required');
  });
  it('blocks encrypted media and preserves the source before purge', async () => {
    const { d } = deps([]);
    d.targetFor = async () => 'b';
    d.mediaInventory = async (fromGroup, toGroup, clubId) => ({ fromGroup, toGroup, clubId, complete: true, encryptedObjects: 1, pendingUploads: 0, sharedQuotaReady: true });
    const a = liveTransferAdapter(d);
    await expect(a.verifyMedia?.('a', 'b', 'club')).rejects.toThrow('Encrypted media');
    await expect(a.purgeSource('a', 'club')).rejects.toThrow('Encrypted media');
    expect(d.actors('a').media_metadata.purge_club_snapshot).not.toHaveBeenCalled();
  });
  it('folds older sponsor-only numbers into the club when it is locked, in chunks of 500', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `sp${i}`);
    const { d, claim } = deps(ids);
    await liveTransferAdapter(d).setFence('a', 'club', true);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim.mock.calls[0]).toEqual(['club', ids.slice(0, 500)]);
  });

  it('does not fold sponsor numbers when unlocking', async () => {
    const { d, claim } = deps(['sp1']);
    await liveTransferAdapter(d).setFence('a', 'club', false);
    expect(claim).not.toHaveBeenCalled();
  });

  it('refuses a canister without move endpoints instead of skipping it', async () => {
    const { d } = deps([]);
    const a = liveTransferAdapter(d);
    await expect(a.exportPage('a', 'club', 'new_unknown_domain', null)).rejects.toThrow('refusing');
    await expect(a.digest('a', 'club', 'new_unknown_domain')).rejects.toThrow('refusing');
    expect(await a.exportPage('a', 'club', 'secret_workload_identity', null)).toEqual({ rows: [], next: null });
  });
});
