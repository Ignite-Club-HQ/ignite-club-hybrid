import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), results: vi.fn(), vote: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'parent' } }) }));
vi.mock('@/live/loadBackendRouting', () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: mocks.dispatch }));
vi.mock('@/live/features/messaging', () => ({ getLivePollResults: mocks.results, voteLivePoll: mocks.vote, closeLivePoll: vi.fn(), deleteLivePoll: vi.fn() }));
import { PollCard } from './PollCard';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('poll scope and recovery', () => {
  it('loads and votes in Peanut using the captured conversation scope', async () => {
    window.history.replaceState({}, '', '/groups/peanut');
    mocks.results.mockResolvedValue({ poll: { id: 'poll-a', question: 'Training day?', options: ['Saturday', 'Sunday'], creator: { toText: () => 'coach' }, created_at_ms: 1000n, closed: false }, counts: [1, 0] });
    mocks.dispatch.mockImplementation(async (_feature, providers) => providers.icp({ target: 'group-1' }));
    mocks.vote.mockResolvedValue({});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><PollCard pollId="poll-a" /></QueryClientProvider>);
    await screen.findByText('Training day?');
    expect(mocks.dispatch.mock.calls[0][2]).toEqual({ conversationId: 'peanut' });
    fireEvent.click(screen.getByText('Saturday'));
    await waitFor(() => expect(mocks.vote).toHaveBeenCalledWith({ target: 'group-1' }, 'poll-a', 0));
    expect(mocks.dispatch.mock.calls[1][2]).toEqual({ conversationId: 'peanut', writeKey: 'once', attempts: 1 });
    expect(client.getQueryData(['poll', 'poll-a', 'parent', JSON.stringify({ conversationId: 'peanut' })])).toBeDefined();
    client.clear();
  });
});