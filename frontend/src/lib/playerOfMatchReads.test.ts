import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rewards: vi.fn(), roles: vi.fn(), from: vi.fn(), scope: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: m.from } }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_: string, h: { icp: (ctx: object) => unknown }, scope: object) => { m.scope(scope); return h.icp({}); } }));
vi.mock('@/live/features/points', () => ({ listLiveClubRewards: m.rewards }));
vi.mock('@/live/features/membership', () => ({ listLiveRoleGrants: m.roles }));
import { readPlayerOfMatchAdults, readPlayerOfMatchRewards } from './playerOfMatchReads';
const reward = (id: string, team: string[], extra = {}) => ({ id, club_id: 'club', team_id: team, is_active: true, reward_type: 'player_of_match', created_at_ms: 1n, description: [], logo_url: [], qr_code_url: [], sponsor_id: [], ...extra });
describe('ICP match rewards and player eligibility', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses exact-team rewards before club defaults and never queries Supabase', async () => {
    m.rewards.mockResolvedValue([reward('default', []), reward('team', ['team']), reward('other', ['other'])]);
    expect((await readPlayerOfMatchRewards('club', 'team')).map(r => r.id)).toEqual(['team']);
    expect(m.scope).toHaveBeenCalledWith({ clubId: 'club' });
    expect(m.from).not.toHaveBeenCalled();
  });
  it('falls back only to active club-wide match rewards', async () => {
    m.rewards.mockResolvedValue([reward('default', []), reward('other', ['other']), reward('inactive', [], { is_active: false }), reward('points', [], { reward_type: 'points' }), reward('foreign', [], { club_id: 'foreign' })]);
    expect((await readPlayerOfMatchRewards('club', 'team')).map(r => r.id)).toEqual(['default']);
  });
  it('keeps creation ordering and decodes optional reward fields', async () => {
    m.rewards.mockResolvedValue([reward('new', [], { created_at_ms: 2n }), reward('old', [], { qr_code_url: ['qr'] })]);
    const rows = await readPlayerOfMatchRewards('club');
    expect(rows.map(r => r.id)).toEqual(['old', 'new']);
    expect(rows[0].qr_code_url).toBe('qr');
    expect(rows[0].team_id).toBeNull();
  });
  it('includes only exact-team adult players and normalizes principal IDs', async () => {
    m.roles.mockResolvedValue([{ role: 'player', team: ['team'], account_id: 'principal:paul' }, { role: 'coach', team: ['team'], account_id: 'coach' }, { role: 'player', team: ['other'], account_id: 'other' }]);
    expect(await readPlayerOfMatchAdults('club', 'team')).toEqual(['paul']);
    expect(m.from).not.toHaveBeenCalled();
  });
  it('propagates refused catalog reads instead of using unrelated defaults', async () => {
    m.rewards.mockRejectedValue(new Error('denied'));
    await expect(readPlayerOfMatchRewards('club', 'team')).rejects.toThrow('denied');
    expect(m.from).not.toHaveBeenCalled();
  });
});