import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), channel: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: state.channel, from: state.from } }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/live/loadBackendRouting', () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_f: unknown, providers: { icp: (ctx: unknown) => unknown }) => providers.icp({}) }));
vi.mock('@/live/features/events', () => ({ getLiveEventGroup: state.read, syncLiveGroupState: state.write }));
import { useEventGroupSync } from './useEventGroupSync';
const team = 'event-group-g';
const timerKey = `pitch-board-timer-state-team-${team}`;
const pitchKey = `ignite-pitch-board-state-team-${team}`;
const row = (revision: bigint, elapsed = 30) => ({ state_revision: revision, timer_state_json: [JSON.stringify({ elapsedSeconds: elapsed, currentHalf: 1, lastUpdateTime: Date.now() })], pitch_state_json: ['{"players":[]}'] });
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); state.read.mockResolvedValue(row(2n)); state.write.mockResolvedValue(row(3n)); });
describe('canister group clock synchronization', () => {
  it('spectators read authoritative state and never open Supabase or write clocks', async () => {
    const view = renderHook(() => useEventGroupSync(team, 'g', { readOnly: true }));
    await waitFor(() => expect(localStorage.getItem(timerKey)).not.toBeNull());
    await act(async () => { view.result.current.forceSync(); });
    view.unmount();
    expect(state.write).not.toHaveBeenCalled(); expect(state.channel).not.toHaveBeenCalled(); expect(state.from).not.toHaveBeenCalled();
  });
  it('writes the exact loaded revision and reloads on a competing clock update', async () => {
    const view = renderHook(() => useEventGroupSync(team, 'g'));
    await waitFor(() => expect(localStorage.getItem(pitchKey)).not.toBeNull());
    localStorage.setItem(timerKey, JSON.stringify({ elapsedSeconds: 40, currentHalf: 1, lastUpdateTime: Date.now() }));
    state.write.mockRejectedValueOnce(new Error('State revision conflict'));
    state.read.mockResolvedValue(row(4n, 50));
    await act(async () => { view.result.current.forceSync(); });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(timerKey) ?? '{}').elapsedSeconds).toBe(50));
    expect(state.write.mock.calls[0]?.[2]).toBe(2n);
    view.unmount();
  });
});
