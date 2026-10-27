import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IcpIdentityProfile } from '@/live/identityProfileCache';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), confirmed: vi.fn() }));
vi.mock('@/live/internetIdentityAuth', () => ({
  warmInternetIdentityAuthClient: async () => undefined,
  isInternetIdentitySignInReady: () => true,
  getCurrentInternetIdentityConfirmed: mocks.confirmed,
  clearExpiredInternetIdentitySession: () => false,
}));
vi.mock('@/live/identityProfile', () => ({ fetchIcpIdentityProfile: mocks.fetch }));
import { IcpAuthProvider, useAuth } from './useAuth';

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ provider: 'internet-identity', principal: 'account-a' }));
  mocks.confirmed.mockResolvedValue({});
});

it('adopts an acknowledged save without a second fetch and rejects an older missing-profile reply', async () => {
  let resolveOld: ((profile: IcpIdentityProfile) => void) | undefined;
  mocks.fetch.mockImplementation(() => new Promise<IcpIdentityProfile>(resolve => { resolveOld = resolve; }));
  let refresh: ReturnType<typeof useAuth>['refreshProfile'] | undefined;
  function Page() { const auth = useAuth(); refresh = auth.refreshProfile; return <div>{auth.profile?.display_name ?? 'Missing'}</div>; }
  render(<QueryClientProvider client={new QueryClient()}><IcpAuthProvider><Page /></IcpAuthProvider></QueryClientProvider>);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  const saved = { accountId: 'account-a', displayName: 'Test Parent', avatarRef: null, roles: [], profileMissing: false };
  await act(async () => { await refresh?.(saved); });
  expect(screen.getByText('Test Parent')).toBeTruthy();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await act(async () => { resolveOld?.({ ...saved, displayName: null, profileMissing: true }); });
  expect(screen.getByText('Test Parent')).toBeTruthy();
  await expect(refresh?.({ ...saved, accountId: 'other-account' })).rejects.toThrow('signed-in account');
  expect(screen.getByText('Test Parent')).toBeTruthy();
});