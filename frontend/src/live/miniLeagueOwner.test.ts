import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupMiniLeagueOwner } from './miniLeagueOwner';

const { get, connect } = vi.hoisted(() => ({ get: vi.fn(), connect: vi.fn() }));
vi.mock('./domains', () => ({ connectLiveMiniLeagueDomain: connect }));
const context = { target: {}, identity: {} } as never;
beforeEach(() => {
  get.mockReset();
  connect.mockReset();
  connect.mockResolvedValue({ actor: { get_mini_leagues: get } });
});
describe('authorized league ownership', () => {
  it('returns the owning club from the authorized batch read', async () => {
    get.mockResolvedValue({ Ok: [{ id: 'league-a', club_id: 'club-b' }] });
    expect(await lookupMiniLeagueOwner(context, 'league-a')).toBe('club-b');
    expect(get).toHaveBeenCalledWith(['league-a']);
  });
  it('does not infer ownership for a hidden or absent league', async () => {
    get.mockResolvedValue({ Ok: [] });
    expect(await lookupMiniLeagueOwner(context, 'hidden')).toBeNull();
  });
  it('propagates rejection instead of guessing the shared group', async () => {
    get.mockResolvedValue({ Err: 'Forbidden' });
    await expect(lookupMiniLeagueOwner(context, 'league-a')).rejects.toThrow('Forbidden');
  });
  it('propagates transport loss instead of guessing the shared group', async () => {
    const failure = new Error('Network unavailable');
    connect.mockRejectedValue(failure);
    const outcome = await lookupMiniLeagueOwner(context, 'league-a').then(
      value => ({ value }),
      error => ({ error }),
    );
    expect(outcome).toEqual({ error: failure });
  });
});