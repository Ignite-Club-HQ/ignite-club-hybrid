import { describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/live/domains', () => ({ connectLiveEventsDomain: async () => ({ actor: { get_active_game: mocks.read } }) }));
import { getLiveActiveGame } from './features/events';
describe('active-game asynchronous read', () => {
  it('waits for the canister response before inspecting the optional record', async () => {
    const row = { id: 'board', updated_at_ms: 42n, pitch_state_json: '{"sport":"basketball"}' };
    mocks.read.mockResolvedValue({ Ok: [row] });
    expect(await getLiveActiveGame({} as never, 'team')).toEqual([row]);
    expect(mocks.read).toHaveBeenCalledWith(['team']);
  });
  it('returns absence without converting it into a stalled or failed board', async () => {
    mocks.read.mockResolvedValue({ Ok: [] });
    expect(await getLiveActiveGame({} as never, 'team')).toEqual([]);
  });
  it('preserves authorization refusal without fallback', async () => {
    mocks.read.mockResolvedValue({ Err: 'Forbidden' });
    await expect(getLiveActiveGame({} as never, 'team')).rejects.toThrow('Forbidden');
  });
});