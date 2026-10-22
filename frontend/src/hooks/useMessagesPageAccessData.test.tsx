import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ mode: 'supabase', routing: vi.fn(), grants: vi.fn(), teams: vi.fn(), clubs: vi.fn(), iap: vi.fn() }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => mocks.mode }));
vi.mock('@/hooks/useIsAppAdmin', () => ({ useIsAppAdmin: () => ({ isAppAdmin: false, isLoading: false }) }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_feature: unknown, providers: { icp: (ctx: unknown) => unknown }, scope: unknown) => {
  mocks.routing(scope); return providers.icp({});
} }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: () => mocks.grants() }));
vi.mock('@/live/features/proAccess', () => ({ listLiveTeamSubscriptions: () => mocks.teams(), listLiveClubSubscriptions: () => mocks.clubs(),
  liveHasAnyPro: (value: { is_pro?: boolean }) => !!value?.is_pro, fetchLiveCallerIapPro: () => mocks.iap() }));
import { useMessagesPageAccessData } from './useMessagesPageAccessData';
beforeEach(() => {
  vi.clearAllMocks(); mocks.mode = 'supabase'; mocks.grants.mockResolvedValue([]);
  mocks.teams.mockResolvedValue(new Map()); mocks.clubs.mockResolvedValue(new Map([['g2-club', { is_pro: true }]])); mocks.iap.mockResolvedValue(false);
});
function mount(client: { from: (table: string) => unknown }) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => useMessagesPageAccessData({ client: client as never, userId: 'caller', initialized: true, useIcpLab: false,
    memberClubs: [{ id: 'g2-club' }] }), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={queries}>{children}</QueryClientProvider> });
  return { ...hook, queries };
}
describe('Messages access reads', () => {
  it('starts owned and guarded children together and combines their assignment IDs once', async () => {
    const requested: string[] = []; const assignment = vi.fn();
    let finishOwned: ((value: unknown) => void) | undefined;
    const client = { from: (table: string) => {
      const builder = { select: () => builder, eq: () => builder, in: (_field: string, ids: string[]) => { if (table === 'child_mini_league_assignments') assignment(ids); return builder; },
        maybeSingle: () => builder, then: (resolve: (value: unknown) => void) => {
          requested.push(table);
          if (table === 'children') return new Promise(r => { finishOwned = r; }).then(resolve);
          return Promise.resolve({ data: table === 'child_guardians' ? [{ child_id: 'shared' }, { child_id: 'guarded' }] : table === 'child_mini_league_assignments' ? [{ mini_league_id: 'league' }] : [], error: null }).then(resolve);
        } };
      return builder;
    } };
    const hook = mount(client);
    await waitFor(() => expect(requested).toContain('child_guardians'));
    expect(requested).toContain('children'); expect(assignment).not.toHaveBeenCalled();
    finishOwned?.({ data: [{ id: 'owned' }, { id: 'shared' }], error: null });
    await waitFor(() => expect(hook.result.current.userLeagueIds).toEqual(new Set(['league'])));
    expect(assignment).toHaveBeenCalledExactlyOnceWith(['owned', 'shared', 'guarded']);
    hook.unmount();
  });
  it('runs ICP subscription aggregation once, not once for every registered group', async () => {
    mocks.mode = 'icp'; mocks.grants.mockResolvedValue([{ club: ['g2-club'], team: ['g2-team'] }]);
    const from = vi.fn(); const hook = mount({ from });
    await waitFor(() => expect(hook.queries.getQueryCache().find({ queryKey: ['club-pro-status'], exact: false })?.state.error).toBeNull());
    await waitFor(() => expect(hook.queries.getQueryCache().find({ queryKey: ['club-pro-status'], exact: false })?.state).toMatchObject({ status: 'success', data: { 'g2-club': true } }), { timeout: 10000 });
    await waitFor(() => expect(hook.result.current.hasAnyProAccess).toBe(true));
    expect(mocks.routing.mock.calls.map(call => call[0])).toEqual([{ shared: 'person' }, { shared: 'person' }]);
    expect(mocks.grants).toHaveBeenCalledTimes(1); expect(from).not.toHaveBeenCalled();
    hook.unmount();
  });
});