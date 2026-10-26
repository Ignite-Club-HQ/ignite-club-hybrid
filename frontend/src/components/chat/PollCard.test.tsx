import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), results: vi.fn(), vote: vi.fn(), icp: true, channel: vi.fn(), removeChannel: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: mocks.channel, removeChannel: mocks.removeChannel } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'parent' } }) }));
vi.mock('@/live/loadBackendRouting', () => ({ isFeatureRoutedToIcp: () => mocks.icp }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: mocks.dispatch }));
vi.mock('@/live/features/messaging', () => ({ getLivePollResults: mocks.results, voteLivePoll: mocks.vote, closeLivePoll: vi.fn(), deleteLivePoll: vi.fn(), takeBundledPollResult: () => null }));
vi.mock('@/lib/profileCache', () => ({ fetchProfilesWithCache: async () => new Map([
  ['parent', { display_name: 'Paul', avatar_url: null }],
  ['member-2', { display_name: 'Alex', avatar_url: null }],
]) }));
import { PollCard } from './PollCard';
import { prefetchMessagePolls } from '@/lib/pollReadRepository';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  mocks.icp = true;
  mocks.channel.mockImplementation(() => {
    if (mocks.icp) throw new Error('ICP poll must not subscribe to Supabase');
    const channel = { on: vi.fn(), subscribe: vi.fn() };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    return channel;
  });
});
describe('poll scope and recovery', () => {
  it('updates the choice and count while an ICP vote is pending and restores the previous vote on refusal', async () => {
    window.history.replaceState({}, '', '/groups/peanut');
    mocks.dispatch.mockImplementation(async (_feature, providers) => providers.icp({ target: 'group-1' }));
    let rejectVote: ((reason: Error) => void) | undefined;
    mocks.vote.mockImplementation(() => new Promise((_resolve, reject) => { rejectVote = reject; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ['poll', 'fast-vote', 'parent', JSON.stringify({ conversationId: 'peanut' })];
    client.setQueryData(key, {
      poll: { id: 'fast-vote', question: 'Training day?', allow_multiple: false, created_by: 'coach', created_at: '2026-10-23T00:00:00Z', closed_at: null, closes_at: null },
      options: [{ id: '0', label: 'Saturday', position: 0 }, { id: '1', label: 'Sunday', position: 1 }],
      votes: [{ id: 'mine', option_id: '0', user_id: 'parent' }], closed: false,
    });
    render(<QueryClientProvider client={client}><PollCard pollId="fast-vote" /></QueryClientProvider>);
    const saturday = screen.getByRole('button', { name: /Saturday/ });
    const sunday = screen.getByRole('button', { name: /Sunday/ });
    expect(saturday).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(sunday);
    await waitFor(() => expect(sunday).toHaveAttribute('aria-pressed', 'true'));
    expect(sunday).toHaveAttribute('aria-busy', 'true');
    expect(saturday).toHaveAttribute('aria-pressed', 'false');
    expect(client.getQueryData<{ votes: unknown[] }>(key)?.votes).toHaveLength(1);
    expect(mocks.vote).toHaveBeenCalledTimes(1);
    await act(async () => rejectVote?.(new Error('Poll closed')));
    await waitFor(() => expect(saturday).toHaveAttribute('aria-pressed', 'true'));
    expect(sunday).toHaveAttribute('aria-pressed', 'false');
    expect(sunday).toHaveAttribute('aria-busy', 'false');
    client.clear();
  });
  it('shows Supabase voters using the already-loaded poll votes', async () => {
    mocks.icp = false;
    window.history.replaceState({}, '', '/groups/peanut');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['poll', 'sb-poll', 'parent', JSON.stringify({ conversationId: 'peanut' })], {
      poll: { id: 'sb-poll', question: 'Training day?', allow_multiple: true, created_by: 'coach', created_at: '2026-10-23T00:00:00Z', closed_at: null, closes_at: null },
      options: [{ id: 'sat', label: 'Saturday', position: 0 }, { id: 'sun', label: 'Sunday', position: 1 }],
      votes: [{ id: 'v1', option_id: 'sat', user_id: 'parent' }, { id: 'v2', option_id: 'sun', user_id: 'member-2' }],
      closed: false, voterDetailsAvailable: true,
    });
    render(<QueryClientProvider client={client}><PollCard pollId="sb-poll" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'View votes' }));
    expect((await screen.findByText('Paul')).closest('section')?.textContent).toContain('Saturday');
    expect((await screen.findByText('Alex')).closest('section')?.textContent).toContain('Sunday');
    expect(mocks.results).not.toHaveBeenCalled();
    expect(mocks.channel).toHaveBeenCalledTimes(1);
    client.clear();
  });
  it('opens the bottom drawer with voters under their selected option', async () => {
    window.history.replaceState({}, '', '/groups/peanut');
    mocks.results.mockResolvedValue({ poll: { id: 'poll-voters', question: 'Training day?', options: ['Saturday', 'Sunday'], creator: { toText: () => 'coach' }, created_at_ms: 1000n, closed: false }, counts: [1, 1], votes: [[
      { poll_id: 'poll-voters', user: { toText: () => 'parent' }, option_index: 0 },
      { poll_id: 'poll-voters', user: { toText: () => 'member-2' }, option_index: 1 },
    ]] });
    mocks.dispatch.mockImplementation(async (_feature, providers) => providers.icp({ target: 'group-1' }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><PollCard pollId="poll-voters" /></QueryClientProvider>);
    await screen.findByText('Training day?');
    fireEvent.click(screen.getByRole('button', { name: 'View votes' }));
    await screen.findByText('Paul');
    const alex = await screen.findByText('Alex');
    expect(alex.closest('section')?.textContent).toContain('Sunday');
    expect(screen.getByText('Paul').closest('section')?.textContent).toContain('Saturday');
    expect(mocks.channel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close votes' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'closed'));
    client.clear();
  });
  it('joins the poll read started before rendering and reopens from the same cached result', async () => {
    window.history.replaceState({}, '', '/groups/peanut');
    let finish: ((value: unknown) => void) | undefined;
    mocks.results.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.dispatch.mockImplementation(async (_feature, providers) => providers.icp({ target: 'group-1' }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    prefetchMessagePolls(client, [{ body: '[poll:poll-a] [poll:poll-a]' }], 'parent', { conversationId: 'peanut' }, true);
    const view = render(<QueryClientProvider client={client}><PollCard pollId="poll-a" /></QueryClientProvider>);
    await waitFor(() => expect(mocks.results).toHaveBeenCalledTimes(1));
    finish?.({ poll: { id: 'poll-a', question: 'Training day?', options: ['Saturday'], creator: { toText: () => 'coach' }, created_at_ms: 1000n, closed: false }, counts: [1] });
    await screen.findByText('Training day?');
    view.unmount();
    mocks.results.mockImplementation(() => new Promise(() => {}));
    render(<QueryClientProvider client={client}><PollCard pollId="poll-a" /></QueryClientProvider>);
    expect(screen.getByText('Training day?')).toBeInTheDocument();
    expect(mocks.results).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['poll', 'poll-a', 'other-account', JSON.stringify({ conversationId: 'peanut' })])).toBeUndefined();
    expect(client.getQueryData(['poll', 'poll-a', 'parent', JSON.stringify({ conversationId: 'other-chat' })])).toBeUndefined();
    client.clear();
  });
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
    expect(mocks.dispatch.mock.calls[1][2]).toEqual({ conversationId: 'peanut', writeKey: expect.stringMatching(/^once-/), attempts: 1 });
    expect(client.getQueryData(['poll', 'poll-a', 'parent', JSON.stringify({ conversationId: 'peanut' })])).toBeDefined();
    client.clear();
  });
});