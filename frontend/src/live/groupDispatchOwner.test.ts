import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClubDispatcher, clearGroupDispatchCache } from './groupDispatch';
import { OFF, SHIPPED_GATES, activationStatus } from './groupActivation';
beforeEach(clearGroupDispatchCache);
function world(owner: boolean) {
  const legacy = vi.fn(async () => 'shared'); const read = vi.fn(async () => 'g2');
  const d = { gates: () => OFF, ownerActive: vi.fn(async () => owner), legacy, context: async () => ({ identity: { getPrincipal: () => ({ toText: () => 'owner' }) },
    target: { alias: 'ic', host: 'https://icp-api.io', networkKind: 'public_mainnet', canisterIds: {} } }), open: async () => ({ isAssigned: (c: string) => c === 'test', readClub: read,
    writeClub: read, dispose: vi.fn(), readEveryGroup: vi.fn(async () => []), createInGroup: read }), placeNewClub: vi.fn(async (_c, id) => ({ clubId: id, groupId: 'g2', revision: 2n })) };
  return { d, legacy, read, dispatch: createClubDispatcher(d as never) };
}
describe('independent owner dispatch', () => {
  it('routes the approved owner club while shared clubs stay shared and global gates stay off', async () => { const w = world(true); expect(await w.dispatch.read('membership', 'test', 'club_domain', async () => 'x')).toBe('g2'); expect(await w.dispatch.read('membership', 'old', 'club_domain', async () => 'x')).toBe('shared'); expect(activationStatus(SHIPPED_GATES).active).toBe(false); });
  it('other callers never activate group dispatch', async () => { const w = world(false); expect(await w.dispatch.read('membership', 'test', 'club_domain', async () => 'x')).toBe('shared'); expect(w.read).not.toHaveBeenCalled(); });
  it('a failed owner approval read cannot silently dispatch to shared', async () => { const w = world(true); w.d.ownerActive.mockRejectedValue(new Error('unavailable')); await expect(w.dispatch.read('membership', 'test', 'club_domain', async () => 'x')).rejects.toThrow('unavailable'); expect(w.legacy).not.toHaveBeenCalled(); });
  it('creates once after approved placement under the separate owner policy', async () => { const w = world(true); await w.dispatch.forNewClub('membership', 'test', async () => 'x'); expect(w.d.placeNewClub).toHaveBeenCalledTimes(1); expect(w.read).toHaveBeenCalledTimes(1); expect(w.legacy).not.toHaveBeenCalled(); });
});