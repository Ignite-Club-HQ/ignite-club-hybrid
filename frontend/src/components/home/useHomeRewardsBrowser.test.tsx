import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHomeRewardsBrowser } from './useHomeRewardsBrowser';
import { homeRewardQuery } from '@/features/home/homeRewardQuery';

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/features/home/homeRewardsRepository', () => ({ fetchAvailableHomeRewardsForBackend: state.read }));
afterEach(() => state.read.mockReset());

describe('first-tap rewards browsing', () => {
  it('opens and selects the active club before eligibility or Home finishes loading', () => {
    const { result } = renderHook(() => useHomeRewardsBrowser('goat', []));
    act(() => result.current.browse());
    expect(result.current.open).toBe(true);
    expect(result.current.selectedClubId).toBe('goat');
  });

  it('opens immediately in all-club mode and selects the sole eligible club when it arrives', () => {
    const { result, rerender } = renderHook(({ ids }) => useHomeRewardsBrowser(null, ids), { initialProps: { ids: [] as string[] } });
    act(() => result.current.browse());
    expect(result.current.open).toBe(true);
    expect(result.current.selectedClubId).toBeNull();
    rerender({ ids: ['cats'] });
    expect(result.current.selectedClubId).toBe('cats');
  });

  it('does not choose between multiple eligible clubs or overwrite the member’s selection', () => {
    const { result, rerender } = renderHook(({ ids }) => useHomeRewardsBrowser(null, ids), { initialProps: { ids: ['goat', 'cats'] } });
    act(() => result.current.browse());
    expect(result.current.selectedClubId).toBeNull();
    act(() => result.current.setSelectedClubId('goat'));
    rerender({ ids: ['cats'] });
    expect(result.current.selectedClubId).toBe('goat');
  });

  it('loads the selected catalogue while another club remains suspended and reuses it on reopening', async () => {
    let resolveGoat: ((value: { id: string }[]) => void) | undefined;
    state.read.mockImplementation((_client, _ctx, clubId) => clubId === 'cats'
      ? new Promise(() => {})
      : new Promise(resolve => { resolveGoat = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Browser() {
      const browser = useHomeRewardsBrowser('goat', []);
      useQuery(homeRewardQuery({}, 'paul', 'icp', 'cats'));
      const rewards = useQuery(homeRewardQuery({}, 'paul', 'icp', browser.selectedClubId));
      return <>
        <button onClick={browser.browse}>View Rewards</button>
        {browser.open && <div role="dialog">
          <button onClick={() => browser.setOpen(false)}>Close</button>
          {rewards.data?.map(row => <p key={row.id}>{row.id}</p>)}
        </div>}
      </>;
    }
    const mounted = render(<QueryClientProvider client={client}><Browser /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'View Rewards' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(state.read).toHaveBeenCalledWith(expect.anything(), null, 'goat'));
    await act(async () => resolveGoat?.([{ id: 'Scarf' }]));
    expect(await screen.findByText('Scarf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Rewards' }));
    expect(screen.getByText('Scarf')).toBeInTheDocument();
    expect(state.read.mock.calls.filter(call => call[2] === 'goat')).toHaveLength(1);
    mounted.unmount();
    client.clear();
  });
});