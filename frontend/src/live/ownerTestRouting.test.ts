import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn(), hosted: vi.fn(), version: vi.fn(async () => 4n) }));
vi.mock('./domains', () => ({ connectLiveShardRouter: async () => ({ actor: { read_my_owner_test_opening: m.read, read_hosted_club_assignment: m.hosted, version: m.version } }) }));
import { clearOwnerTestRouting, readOwnerTestRoute, nextOwnerTestClubId, hasOwnerTestRouting } from './ownerTestRouting';
const id = '00000000-0000-4000-8000-000000000001';
const context = (who = 'owner') => ({ identity: { getPrincipal: () => ({ toText: () => who }) }, target: { alias: 'ic', host: 'https://icp-api.io', networkKind: 'public_mainnet', canisterIds: { shard_router: 'router' } } }) as never;
const receipt = (accepting_new = true) => ({ accepting_new, approval: { owner: { toText: () => 'owner' }, group: { id: 'g2', target_alias: 'ic', accepting: false },
  placement: { host: 'https://icp-api.io', network_kind: 'public_mainnet' }, club_ids: [id], evidence_sha256: 'ab'.repeat(32) } });
beforeEach(() => { clearOwnerTestRouting(); vi.clearAllMocks(); m.read.mockResolvedValue({ Ok: [receipt()] }); });
describe('caller-scoped owner routing', () => {
  it('does not use another caller receipt or activate global gates', async () => { await expect(readOwnerTestRoute(context('other'))).rejects.toThrow('identity'); expect(hasOwnerTestRouting()).toBe(false); });
  it('retains existing-club routing after stopping but denies new clubs', async () => { m.read.mockResolvedValue({ Ok: [receipt(false)] }); expect(await readOwnerTestRoute(context())).toMatchObject({ groupId: 'g2', acceptingNew: false }); expect(hasOwnerTestRouting(context())).toBe(true); await expect(nextOwnerTestClubId(context(), 'random')).rejects.toThrow('stopped'); });
  it('uses only the next approved fresh UUID', async () => { m.hosted.mockResolvedValue({ Err: 'Missing club assignment' }); expect(await nextOwnerTestClubId(context(), 'random')).toBe(id); expect(m.hosted).toHaveBeenCalledWith(id, 'ic', 4n); });
  it('never replays reserved or unknown-outcome creates', async () => { m.hosted.mockResolvedValue({ Ok: { group_id: 'g2' } }); await expect(nextOwnerTestClubId(context(), 'random')).rejects.toThrow('reserved'); m.hosted.mockRejectedValue(new Error('timeout')); await expect(nextOwnerTestClubId(context(), 'random')).rejects.toThrow('timeout'); });
  it('a transport error or disappearing receipt never falls back to shared', async () => { await readOwnerTestRoute(context()); m.read.mockRejectedValue(new Error('network unavailable')); await expect(readOwnerTestRoute(context())).rejects.toThrow('unavailable'); m.read.mockResolvedValue({ Ok: [] }); await expect(readOwnerTestRoute(context())).rejects.toThrow('disappeared'); });
  it('a fresh checkout without a router preserves existing behavior', async () => { const ctx = context() as any; ctx.target.canisterIds = {}; expect(await readOwnerTestRoute(ctx)).toBeNull(); expect(m.read).not.toHaveBeenCalled(); });
});