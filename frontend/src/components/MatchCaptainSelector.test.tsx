import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ match: vi.fn(), season: vi.fn(), profiles: vi.fn(), oldRead: vi.fn(), route: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'paul' } }), useOptionalAuth: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/live/loadBackendRouting', () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: m.oldRead } }));
vi.mock('@/lib/profileCache', () => ({ selectCachedProfileById: m.oldRead }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (feature: string, providers: any, scope: any) => {
  m.route(feature, scope); return providers.icp({});
} }));
vi.mock('@/live/features/events', () => ({ listLiveMatchCaptains: m.match, setLiveMatchCaptain: vi.fn(), removeLiveMatchCaptain: vi.fn() }));
vi.mock('@/live/features/club', () => ({ listLiveTeamCaptains: m.season }));
vi.mock('@/lib/playerOfMatchReads', () => ({ readPlayerOfMatchAdults: async () => ['paul'], readProfileSummaries: m.profiles }));
import MatchCaptainSelector from './MatchCaptainSelector';

const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><MatchCaptainSelector eventId="event" clubId="club" teamId="team" isAdmin
    rsvps={[{ id: 'rsvp', status: 'going', user_id: 'paul', profiles: { display_name: 'Paul' } }]} /></QueryClientProvider>);
}
describe('ICP event captain loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.match.mockResolvedValue([]); m.season.mockResolvedValue([]); m.profiles.mockResolvedValue(new Map());
  });
  afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.useRealTimers(); });

  it('opens the eligible player picker through the known club without old-system reads', async () => {
    const view = mount();
    fireEvent.click(await view.findByRole('button', { name: 'Assign Captain' }));
    expect(await view.findByRole('button', { name: /Paul/ })).toBeTruthy();
    expect(m.route).toHaveBeenCalledWith('events', { clubId: 'club' });
    expect(m.route).toHaveBeenCalledWith('membership', { clubId: 'club' });
    expect(m.oldRead).not.toHaveBeenCalled();
  });
  it('shows an assigned match captain without waiting for season or profile enrichment', async () => {
    m.match.mockResolvedValue([{ event_id: 'event', role: 'captain', ref_kind: 'account', ref_id: 'paul' }]);
    m.season.mockImplementation(() => new Promise(() => {}));
    m.profiles.mockImplementation(() => new Promise(() => {}));
    const view = mount();
    expect(await view.findByText('Paul')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(m.season).not.toHaveBeenCalled();
    expect(m.oldRead).not.toHaveBeenCalled();
  });
  it('hydrates a season captain independently through ICP', async () => {
    m.season.mockResolvedValue([{ user: { toText: () => 'sam' } }]);
    m.profiles.mockResolvedValue(new Map([['sam', { display_name: 'Sam', avatar_url: null }]]));
    const view = mount();
    expect(await view.findByText('Sam')).toBeTruthy();
    expect(m.oldRead).not.toHaveBeenCalled();
  });
  it('settles a stalled season read and lets a retry reopen assignment', async () => {
    vi.useFakeTimers();
    m.season.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue([]);
    const view = mount();
    // A failed season lookup stays settled until explicit retry; do not
    // alternate spinner and errors or repeat successful match reads.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
    expect(m.season).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    fireEvent.click(await view.findByRole('button', { name: 'Try again' }));
    expect(await view.findByRole('button', { name: 'Assign Captain' })).toBeTruthy();
    expect(m.season).toHaveBeenCalledTimes(2);
    expect(m.match).toHaveBeenCalledTimes(1);
  });
  it('does not offer replacement when assignment discovery fails', async () => {
    m.match.mockRejectedValue(new Error('refused'));
    const view = mount();
    await waitFor(() => expect(view.getByRole('button', { name: 'Try again' })).toBeTruthy(), { timeout: 3000 });
    expect(view.queryByRole('button', { name: 'Assign Captain' })).toBeNull();
    expect(m.season).not.toHaveBeenCalled();
    expect(m.match).toHaveBeenCalledTimes(1);
    expect(m.oldRead).not.toHaveBeenCalled();
  });
  it('keeps Captain visible while its read is pending and retries only the failed match check', async () => {
    vi.useFakeTimers();
    m.match.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue([]);
    const view = mount();
    expect(view.getByText('Captain')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
    expect(m.match).toHaveBeenCalledTimes(1);
    expect(m.season).not.toHaveBeenCalled();
    vi.useRealTimers();
    fireEvent.click(await view.findByRole('button', { name: 'Try again' }));
    expect(await view.findByRole('button', { name: 'Assign Captain' })).toBeTruthy();
    expect(m.match).toHaveBeenCalledTimes(2);
    expect(m.season).toHaveBeenCalledTimes(1);
  });
  it('still lets an admin assign a match captain when only the season lookup fails', async () => {
    m.season.mockRejectedValue(new Error('List team captains: Team not found'));
    const view = mount();
    fireEvent.click(await view.findByRole('button', { name: 'Assign Captain' }));
    expect(await view.findByRole('button', { name: /Paul/ })).toBeTruthy();
    expect(view.getByText(/season captain couldn’t be shown/)).toBeTruthy();
    expect(m.match).toHaveBeenCalledTimes(1);
  });
});