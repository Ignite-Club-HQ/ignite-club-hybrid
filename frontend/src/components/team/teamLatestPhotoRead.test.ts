import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeatureBackendContext } from '@/live/featureRouter';
const m = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock('@/live/features/media', () => ({ listLiveAssetsPage: m.page }));
import { readLatestTeamAssets } from './teamLatestPhotoRead';
const ctx = {} as FeatureBackendContext;
const asset = (id: string, team = 'team') => ({ id, team_id: [team], created_at_ms: BigInt(id), deleted: false });
beforeEach(() => m.page.mockReset());
describe('latest team thumbnail reads', () => {
  it('stops after six newest matching photos rather than draining the club', async () => {
    m.page.mockResolvedValueOnce({ assets: [6, 5, 4, 3, 2, 1].map(id => asset(String(id))), next: { club_id: 'club', revision: 1n, before: 'older' } });
    expect((await readLatestTeamAssets(ctx, 'club', 'team')).map(row => row.id)).toEqual(['6', '5', '4', '3', '2', '1']);
    expect(m.page).toHaveBeenCalledTimes(1);
  });
  it('continues past other teams without displaying their photos', async () => {
    const cursor = { club_id: 'club', revision: 1n, before: 'older' };
    m.page.mockResolvedValueOnce({ assets: [asset('9', 'other')], next: cursor }).mockResolvedValueOnce({ assets: [asset('8')], next: null });
    expect((await readLatestTeamAssets(ctx, 'club', 'team')).map(row => row.id)).toEqual(['8']);
    expect(m.page).toHaveBeenLastCalledWith(ctx, 'club', cursor);
  });
  it('preserves denied continuations instead of reporting no photos', async () => {
    m.page.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(readLatestTeamAssets(ctx, 'club', 'team')).rejects.toThrow('Forbidden');
  });
});