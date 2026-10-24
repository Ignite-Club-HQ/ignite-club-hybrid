import { QueryClient } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), board: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: mocks.dispatch }));
vi.mock('@/live/features/events', () => ({ getLiveActiveGame: mocks.board }));
import { boardQueryOptions } from './boardReadRepository';
describe('authorized pitch link reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatch.mockImplementation((_feature, providers) => providers.icp({ target: 'owning-group' }));
    mocks.board.mockResolvedValue([{ pitch_state_json: '{}', timer_state_json: '{"homeScore":2}' }]);
  });
  it('routes by the board team and shares concurrent card/viewer reads', async () => {
    const client = new QueryClient();
    const options = boardQueryOptions('team-g2', 'paul', true);
    const [card, viewer] = await Promise.all([client.ensureQueryData(options), client.ensureQueryData(options)]);
    expect(card.timer_state.homeScore).toBe(2);
    expect(viewer).toEqual(card);
    expect(mocks.board).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith('events', expect.any(Object), { teamId: 'team-g2' });
    expect(mocks.board).toHaveBeenCalledWith({ target: 'owning-group' }, 'team-g2');
    client.clear();
  });
  it('isolates accounts and preserves authorization refusals', async () => {
    expect(boardQueryOptions('team', 'paul', true).queryKey).not.toEqual(boardQueryOptions('team', 'other', true).queryKey);
    mocks.board.mockRejectedValue(new Error('denied'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(client.ensureQueryData(boardQueryOptions('team', 'other', true))).rejects.toThrow('denied');
    client.clear();
  });
});