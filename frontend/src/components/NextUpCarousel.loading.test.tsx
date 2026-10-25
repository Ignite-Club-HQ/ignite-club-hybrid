import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextUpCarousel } from './NextUpCarousel';

const state = vi.hoisted(() => ({ reads: [] as string[], icp: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'account-1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useCanStartGame', () => ({ useCanStartGame: () => ({ canStart: false }) }));
vi.mock('@/hooks/useEventMembership', () => ({ useEventMembership: () => ({ data: undefined, isFetched: false }) }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => state.icp ? 'icp' : 'supabase' }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_: string, handlers: { icp: (ctx: object) => unknown; supabase: () => unknown }) => state.icp ? handlers.icp({}) : handlers.supabase() }));
vi.mock('@/live/features/vault', () => ({ resolveLivePiiTextBatch: vi.fn() }));
vi.mock('@/live/features/events', () => ({ setLiveEventRsvp: vi.fn(), adminUpsertLiveRsvp: vi.fn(),
  getMyLiveChildRsvps: async () => [],
  listLiveMyRsvps: async () => [{ event_id: 'icp-event', account_id: 'account-1', child_id: [], state: 'going' }],
  listLiveDuties: async () => [{ event_id: 'icp-event', account_id: 'account-1', duty: 'Referee', completed: true }],
  getLiveEventRosterDetailed: async () => ({ rsvps: [] }),
}));
vi.mock('@/live/features/homeFeed', () => ({ fetchLiveHomeChildren: vi.fn() }));
// The card statically imports the events module as well as lazily reading it;
// stub its batch transport too so either module evaluation stays offline.
vi.mock('@/live/features/batching', () => ({ batched: async () => [
  { event_id: 'icp-event', account_id: 'account-1', duty: 'Referee', completed: true },
] }));
vi.mock('@/live/features/miniLeagues', () => ({ listLivePlayers: vi.fn() }));
vi.mock('@/lib/resolveEventChildScope', () => ({ resolveRsvpChildren: () => new Promise(() => {}) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'not', 'in', 'limit', 'maybeSingle']) {
    query[method] = (...args: unknown[]) => { state.reads.push(`${table}:${method}:${String(args[0])}`); return query; };
  }
  query.then = () => new Promise(() => {});
  return query;
} } }));

const event = (id: string, clubId: string) => ({
  id, club_id: clubId, title: `Event ${id}`, type: 'social',
  event_date: new Date(Date.now() + 86400000).toISOString(),
  address: null, location_name: null, suburb: null, team_id: null,
  is_cancelled: false, opponent: null, teams: null,
  clubs: { name: clubId, sport: null },
});
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }

describe('Next Up pending secondary reads', () => {
  beforeEach(() => { state.reads = []; state.icp = false; });
  afterEach(cleanup);

  it('opens a known event immediately and after a club switch without waiting for attendance reads', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (id: string, club: string) => <QueryClientProvider client={client}>
      <MemoryRouter><NextUpCarousel events={[event(id, club)]} isLoading={true} /><Location /></MemoryRouter>
    </QueryClientProvider>;
    const view = render(tree('a', 'club-a'));
    fireEvent.click(screen.getByRole('button', { name: /^Event a,/ }));
    expect(screen.getByTestId('location').textContent).toBe('/events/a');
    expect(screen.queryByRole('button', { name: /RSVP Going/ })).toBeNull();
    view.rerender(tree('b', 'club-b'));
    fireEvent.click(screen.getByRole('button', { name: /^Event b,/ }));
    expect(screen.getByTestId('location').textContent).toBe('/events/b');
    expect(client.getQueryState(['hero-rsvp', 'b', 'account-1'])?.status).toBe('pending');
    client.clear();
  });

  it('starts avatar and count reads concurrently while the count remains pending', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NextUpCarousel events={[event('a', 'club-a')]} /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(state.reads).toContain('rsvps:limit:5'));
    expect(client.getQueryState(['rsvp-summary', 'a', 'social'])?.status).toBe('pending');
    client.clear();
  });

  it('mounted ICP cards resolve adult RSVP and completed duties without any Supabase reads', async () => {
    state.icp = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NextUpCarousel events={[event('icp-event', 'club-a')]} /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(client.getQueryData(['hero-rsvp', 'icp-event', 'account-1'])).toEqual({ id: 'icp-event:account-1', status: 'going' }));
    await waitFor(() => { const q = client.getQueryState(['hero-my-duties', 'icp-event', 'account-1']); if (q?.error) throw q.error; expect(q?.data).toEqual([
      { id: 'icp-event:account-1:Referee', name: 'Referee', status: 'completed', start_time: null, end_time: null },
    ]); });
    expect(state.reads).toEqual([]);
    client.clear();
  });
});