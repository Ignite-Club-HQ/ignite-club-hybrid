import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ oldRead: vi.fn(), shortCode: vi.fn().mockResolvedValue('CODE'), route: vi.fn() }));
// Reproduce an II member whose visitor-country sign-in screen selects email.
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'supabase' }));
vi.mock('@/live/loadBackendRouting', () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.oldRead } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_: string, branches: any, scope: unknown) => {
  mocks.route(scope);
  return branches.icp({});
} }));
vi.mock('@/live/features/club', () => ({
  createLiveInviteShortCode: mocks.shortCode, revokeLivePendingInvite: vi.fn(),
  setLivePendingInviteLabel: vi.fn(), updateLivePendingInviteRole: vi.fn(), moveLivePendingInviteTeam: vi.fn(), listLiveTeams: vi.fn(),
}));
import PendingInviteCard from './PendingInviteCard';

describe('ICP pending invitation card', () => {
  it('uses the actual feature provider for a restored II session, not the visitor sign-in choice', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><PendingInviteCard
      teamId="hawks" clubId="club" isAdmin
      invite={{ id: 'invite', role: 'parent', invited_user_id: null, invited_label: 'Alex', created_at: '2026-10-25T00:00:00Z', status: 'pending' }}
    /></QueryClientProvider>);
    await waitFor(() => expect(mocks.shortCode).toHaveBeenCalled());
    expect(view.getByText('Alex')).toBeTruthy();
    expect(mocks.oldRead).not.toHaveBeenCalled();
    expect(mocks.route).toHaveBeenCalledWith({ inviteToken: 'invite' });
    view.unmount();
    client.clear();
  });
});