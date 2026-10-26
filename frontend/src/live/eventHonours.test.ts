import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ honours: vi.fn(), legacy: vi.fn(), actor: {} as any }));
vi.mock('@/live/domains', () => ({ connectLiveEventsDomain: async () => ({ actor: m.actor }) }));
import { listLiveMatchCaptains, listLiveMatchGoalkeepers } from './features/events';

describe('authorized event honours reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = { read_event_honours: m.honours, list_match_captains: m.legacy, list_match_goalkeepers: m.legacy };
  });
  it('shares one in-flight protected read for captain and goalkeeper widgets', async () => {
    let finish: ((value: unknown) => void) | undefined;
    m.honours.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const captain = listLiveMatchCaptains({} as never, 'event');
    const goalkeeper = listLiveMatchGoalkeepers({} as never, 'event');
    await vi.waitFor(() => expect(m.honours).toHaveBeenCalledTimes(1));
    const row = { ref_id: 'paul', role: 'captain' };
    finish?.({ Ok: { captains: [row], goalkeepers: [] } });
    expect(await captain).toEqual([row]);
    expect(await goalkeeper).toEqual([]);
    expect(m.legacy).not.toHaveBeenCalled();
  });
  it('propagates event access refusal, never turns it into absence, and clears failed reads for retry', async () => {
    m.honours.mockResolvedValueOnce({ Err: 'Event access forbidden' }).mockResolvedValue({ Ok: { captains: [], goalkeepers: [] } });
    await expect(listLiveMatchCaptains({} as never, 'event')).rejects.toThrow('Event access forbidden');
    expect(await listLiveMatchCaptains({} as never, 'event')).toEqual([]);
    expect(m.honours).toHaveBeenCalledTimes(2);
    expect(m.legacy).not.toHaveBeenCalled();
  });
  it('never shares in-flight honours across distinct actors/accounts', async () => {
    let finish: ((value: unknown) => void) | undefined;
    m.honours.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = listLiveMatchCaptains({} as never, 'event');
    await vi.waitFor(() => expect(m.honours).toHaveBeenCalledTimes(1));
    const other = vi.fn().mockResolvedValue({ Ok: { captains: [{ ref_id: 'sam' }], goalkeepers: [] } });
    m.actor = { read_event_honours: other };
    expect(await listLiveMatchCaptains({} as never, 'event')).toEqual([{ ref_id: 'sam' }]);
    expect(other).toHaveBeenCalledTimes(1);
    finish?.({ Ok: { captains: [], goalkeepers: [] } });
    expect(await first).toEqual([]);
  });
});