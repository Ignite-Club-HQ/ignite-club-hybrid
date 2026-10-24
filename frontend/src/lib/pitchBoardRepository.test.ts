import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), positions: vi.fn(), preferences: vi.fn(), team: vi.fn(), fanOut: vi.fn(), route: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: mocks.route }));
vi.mock('@/live/features/club', () => ({ getLiveTeamPlayerPositionsV2: mocks.positions, getLiveTeam: mocks.team }));
vi.mock('@/live/features/notifications', () => ({ getLiveNotificationPreferences: mocks.preferences, fanOutLiveNotifications: mocks.fanOut }));
import { pitchPlayerPositionsQuery, readPitchNotificationPreference, notifyIcpSubstitutionDue } from './pitchBoardRepository';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.route.mockImplementation((_feature, branches) => branches.icp({ identity: { getPrincipal: () => ({ toText: () => 'caller' }) } }));
  mocks.positions.mockResolvedValue([]);
  mocks.team.mockResolvedValue([{ club_id: 'club-g2' }]);
  mocks.preferences.mockResolvedValue({ pitchBoardEnabled: false });
  mocks.fanOut.mockResolvedValue(1);
});

describe('pitch-board on-chain gaps', () => {
  it('loads jerseys and canonical preferred positions from the exact team, including child IDs', async () => {
    mocks.positions.mockResolvedValue([
      { member_id: 'principal:caller', positions: ['GK', 'invalid', 'DEF'], jersey_number: [12] },
      { member_id: 'child-1', positions: ['MID'], jersey_number: 7 },
      { member_id: 'child-2', positions: [], jersey_number: [] },
    ]);
    const client = new QueryClient();
    const rows = await client.fetchQuery(pitchPlayerPositionsQuery('team-g2', 'caller', true));
    expect(rows).toEqual([
      { user_id: 'caller', child_id: null, preferred_positions: ['GK', 'DEF'], jersey_number: 12 },
      { user_id: 'child-1', child_id: null, preferred_positions: ['MID'], jersey_number: 7 },
      { user_id: 'child-2', child_id: null, preferred_positions: [], jersey_number: null },
    ]);
    expect(mocks.route).toHaveBeenCalledWith('membership', expect.any(Object), { teamId: 'team-g2' });
    expect(mocks.from).not.toHaveBeenCalled();
    client.clear();
  });

  it('shares concurrent team reads while isolating accounts and backends', async () => {
    const client = new QueryClient();
    await Promise.all([client.fetchQuery(pitchPlayerPositionsQuery('team', 'a', true)), client.fetchQuery(pitchPlayerPositionsQuery('team', 'a', true))]);
    expect(mocks.positions).toHaveBeenCalledTimes(1);
    await client.fetchQuery(pitchPlayerPositionsQuery('team', 'b', true));
    expect(mocks.positions).toHaveBeenCalledTimes(2);
    expect(pitchPlayerPositionsQuery('team', 'a', false).queryKey).not.toEqual(pitchPlayerPositionsQuery('team', 'a', true).queryKey);
    client.clear();
  });

  it('does not turn denied roster access into an empty result', async () => {
    mocks.positions.mockRejectedValue(new Error('denied'));
    const client = new QueryClient();
    await expect(client.fetchQuery({ ...pitchPlayerPositionsQuery('team', 'caller', true), retry: false })).rejects.toThrow('denied');
    expect(mocks.from).not.toHaveBeenCalled();
    client.clear();
  });

  it('uses on-chain pitch notification preferences with personal scope', async () => {
    expect(await readPitchNotificationPreference('caller', true)).toBe(false);
    expect(mocks.route).toHaveBeenCalledWith('notifications', expect.any(Object), { shared: 'person' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('queues only a self reminder in the owning club with no player names and a preference-aware kind', async () => {
    await notifyIcpSubstitutionDue('team-g2', 'event', 'caller', 'operation-1');
    expect(mocks.fanOut).toHaveBeenCalledWith(expect.any(Object), {
      userIds: ['caller'], clubId: 'club-g2', kind: 'pitch_board_substitution',
      body: 'A planned substitution is due', relatedId: 'team-g2', idempotencyKeyPrefix: 'operation-1',
    });
    expect(mocks.route.mock.calls[0][2]).toMatchObject({ teamId: 'team-g2', attempts: 1 });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects a changed caller and does not retry an unknown notification write', async () => {
    await expect(notifyIcpSubstitutionDue('team', null, 'other', 'key')).rejects.toThrow('account changed');
    expect(mocks.fanOut).not.toHaveBeenCalled();
    mocks.fanOut.mockRejectedValue(new Error('unknown outcome'));
    await expect(notifyIcpSubstitutionDue('team', null, 'caller', 'key')).rejects.toThrow('unknown outcome');
    expect(mocks.fanOut).toHaveBeenCalledTimes(1);
  });

  it('retains Supabase player records and errors', async () => {
    const eq = vi.fn().mockResolvedValue({ data: [{ user_id: null, child_id: 'child', preferred_positions: ['FWD', 'bad'], jersey_number: 9 }], error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq }) });
    const client = new QueryClient();
    expect(await client.fetchQuery(pitchPlayerPositionsQuery('team', 'user', false))).toEqual([
      { user_id: null, child_id: 'child', preferred_positions: ['FWD'], jersey_number: 9 },
    ]);
    expect(mocks.route).not.toHaveBeenCalled();
    client.clear();
  });
});