import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- feature routing mocks ----
let eventsRoutedToIcp = false;
vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp: (feature: string) => feature === "events" && eventsRoutedToIcp,
}));
vi.mock("@/live/authBackendMode", () => ({
  resolveAuthBackend: () => (eventsRoutedToIcp ? "icp" : "supabase"),
}));

const getLiveAccountRosterScopeMock = vi.fn();
const leagueDiscoveryMock = vi.hoisted(() => vi.fn());
vi.mock('@/live/accountDiscovery', () => ({ readDiscoveredMiniLeagues: (...args: unknown[]) => leagueDiscoveryMock(...args) }));
const competitionMocks = vi.hoisted(() => ({
  listLivePublicCompetitions: vi.fn(),
  listLiveCompetitionMatches: vi.fn(),
  listLiveCompetitionsMulti: vi.fn(),
  listLiveMyNewsCompetitions: vi.fn(),
}));
const getLiveTeamMock = vi.fn();
const scheduleMocks = vi.hoisted(() => ({ events: vi.fn(), grants: vi.fn(), duties: vi.fn(), profile: vi.fn() }));
vi.mock('@/live/contentRouting', () => ({ readContentInScope: (ctx: unknown, _feature: unknown, _scope: unknown, read: (ctx: unknown) => unknown) => read(ctx) }));
vi.mock('@/live/membershipRouting', () => ({ readMembershipInScope: (ctx: unknown, _scope: unknown, read: (ctx: unknown) => unknown) => read(ctx) }));
vi.mock("@/live/features/events", () => ({
  getLiveAccountRosterScope: (...args: unknown[]) => getLiveAccountRosterScopeMock(...args),
  listLiveEvents: (...args: unknown[]) => scheduleMocks.events(...args),
  listLiveEventDutyTeams: (...args: unknown[]) => scheduleMocks.duties(...args),
}));

vi.mock("@/live/features/membership", () => ({
  getLiveMyRoleGrants: () => scheduleMocks.grants(),
}));

vi.mock("@/live/features/club", () => ({
  getLiveTeam: (...args: unknown[]) => getLiveTeamMock(...args),
  getLiveClubProfile: (...args: unknown[]) => scheduleMocks.profile(...args),
  listLiveTeams: async () => [],
  listLiveSponsors: async () => [],
  getLiveClubSubscription: async () => null,
}));
vi.mock("@/live/features/competitions", () => ({
  listLivePublicCompetitions: (...args: unknown[]) => competitionMocks.listLivePublicCompetitions(...args),
  listLiveCompetitionMatches: (...args: unknown[]) => competitionMocks.listLiveCompetitionMatches(...args),
  listLiveCompetitionsMulti: (...args: unknown[]) => competitionMocks.listLiveCompetitionsMulti(...args),
  listLiveMyNewsCompetitions: (...args: unknown[]) => competitionMocks.listLiveMyNewsCompetitions(...args),
}));

vi.mock("@/live/features/miniLeagues", () => ({
  listMyLiveMiniLeagues: async () => [],
  listLiveMiniLeaguesByClub: async () => [],
  getLiveMiniLeague: async () => null,
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (_feature: string, providers: any) =>
    eventsRoutedToIcp
      ? providers.icp({ identity: {}, target: {} })
      : providers.supabase(),
}));

vi.mock("@/lab/localRuntimeMode", () => ({
  resolveLocalAuthMode: () => false,
}));

// ---- app-level dependency mocks (kept minimal / inert) ----
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "principal-abc", email: "member@example.com" }, profile: null, refreshProfile: vi.fn() }),
}));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => ({ isOnline: true }) }));
vi.mock("@/hooks/useEventViews", () => ({ useUserEventViews: () => ({ data: new Set<string>() }) }));
vi.mock("@/hooks/useScheduleBroadcastListener", () => ({ useScheduleBroadcastListener: () => {} }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: null, setActiveClubTheme: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/components/events/EventCard", () => ({ EventCard: ({ event }: { event: { title: string } }) => <div>{event.title}</div> }));
vi.mock("@/components/ClubTeamFilter", () => ({ ClubTeamFilter: () => null }));
vi.mock("@/components/QueryErrorBanner", () => ({ QueryErrorBanner: () => null }));
vi.mock("@/components/events/EventsHeaderSponsorStrip", () => ({ EventsHeaderSponsorStrip: () => null }));
vi.mock("@/components/events/ScheduleDateStrip", () => ({ ScheduleDateStrip: () => null }));
vi.mock("@/components/events/ClubDaySummary", () => ({ ClubDaySummary: () => null }));
vi.mock("@/components/SponsorOrAdCarousel", () => ({ SponsorOrAdCarousel: () => null }));

vi.mock("@/lab/fixtureDataLayer", () => ({
  getLocalLabClubList: () => [],
}));
vi.mock("@/lab/eventQueryKeys", () => ({ eventKeys: { list: () => ["events"] } }));
vi.mock("@/lab/localEventsService", () => ({
  isLocalEventsCanisterUnavailable: () => false,
  listLocalEvents: async () => [],
}));
vi.mock("@/lab/syntheticIdentities.mjs", () => ({ personas: ["member", "club_admin"] }));

vi.mock("@/lib/scheduleCache", () => ({ getCachedEventsList: () => null, cacheEventsList: () => {} }));
vi.mock("@/lib/filterRecurringEvents", () => ({ filterRecurringEvents: (events: unknown[]) => events }));
vi.mock("@/lib/scheduleBroadcast", () => ({ sendScheduleBroadcast: () => {} }));
vi.mock("@/lib/coldStartMarks", () => ({ mark: () => {}, snapshotStages: () => ({}) }));
vi.mock("@/lib/scheduleOpenLatency", () => ({ logScheduleOpenLatency: () => {}, resetScheduleOpenLog: () => {} }));
vi.mock("@/lib/ensureFreshSession", () => ({ ensureFreshSession: async () => {}, isAuthLikeError: () => false }));
vi.mock("@/lib/supabaseAuthRetry", () => ({ abortAllInFlightRestGets: () => {} }));
vi.mock("@/lib/sportEmojis", () => ({ getSportEmoji: () => "" }));
vi.mock("@/lib/icsExport", () => ({ exportEventsIcs: () => {} }));
vi.mock("@/lib/eventTypeLabel", () => ({ getEventTypeLabel: () => "" }));

// ---- supabase mock: generic, records every table queried ----
const queriedTables: string[] = [];
let supabaseEventRows: unknown[] = [];
let supabaseRoleRows: unknown[] = [];
function makeQueryBuilder(table: string) {
  const builder: any = {
    select: () => builder,
    update: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    gte: () => builder,
    lte: () => builder,
    is: () => builder,
    then: (resolve: any) => resolve({ data: table === 'events' ? supabaseEventRows : table === 'user_roles' ? supabaseRoleRows : [], error: null }),
  };
  return builder;
}
const fromMock = vi.fn((table: string) => {
  queriedTables.push(table);
  return makeQueryBuilder(table);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: [string]) => fromMock(...args),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn() },
  },
}));

import EventsPage from "./EventsPage";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/events"]}>
        <EventsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  localStorage.clear();
  supabaseEventRows = [];
  supabaseRoleRows = [];
  scheduleMocks.events.mockReset(); scheduleMocks.events.mockResolvedValue([]);
  scheduleMocks.grants.mockReset(); scheduleMocks.grants.mockResolvedValue([]);
  scheduleMocks.duties.mockReset(); scheduleMocks.duties.mockResolvedValue([]);
  scheduleMocks.profile.mockReset(); scheduleMocks.profile.mockResolvedValue([]);
  leagueDiscoveryMock.mockReset();
  leagueDiscoveryMock.mockResolvedValue([]);
  eventsRoutedToIcp = false;
  getLiveAccountRosterScopeMock.mockReset();
  getLiveAccountRosterScopeMock.mockResolvedValue({ teamIds: ["icp-team-1"], clubIds: [], miniLeagueIds: [] });
  getLiveTeamMock.mockReset();
  getLiveTeamMock.mockResolvedValue([]);
  competitionMocks.listLivePublicCompetitions.mockReset();
  competitionMocks.listLivePublicCompetitions.mockResolvedValue([]);
  competitionMocks.listLiveCompetitionMatches.mockReset();
  competitionMocks.listLiveCompetitionMatches.mockResolvedValue([]);
  competitionMocks.listLiveCompetitionsMulti.mockReset();
  competitionMocks.listLiveCompetitionsMulti.mockResolvedValue([]);
  competitionMocks.listLiveMyNewsCompetitions.mockReset();
  competitionMocks.listLiveMyNewsCompetitions.mockResolvedValue([]);
  fromMock.mockClear();
  queriedTables.length = 0;
});

describe("EventsPage roster-derived team scope routing", () => {
  it("Supabase retains competition-wide events outside the member's host-club membership", async () => {
    supabaseRoleRows = [{ role: "player", club_id: "member-club", team_id: "member-team" }];
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    supabaseEventRows = [
      { id: "cup-social", title: "Cup presentation", type: "social", event_date: tomorrow,
        club_id: "organizer-club", team_id: null, competition_id: "cup", mini_league_id: null,
        is_cancelled: false, is_recurring: false, clubs: { name: "Host", sport: null } },
      { id: "host-social", title: "Private host social", type: "social", event_date: tomorrow,
        club_id: "organizer-club", team_id: null, competition_id: null, mini_league_id: null,
        is_cancelled: false, is_recurring: false, clubs: { name: "Host", sport: null } },
    ];
    const client = renderPage();
    await screen.findByText("Cup presentation");
    expect(screen.queryByText("Private host social")).toBeNull();
    await waitFor(() => {
      const query = client.getQueryCache().getAll().find(q => q.queryKey[0] === "events" && q.queryKey[1] === "supabase" && Array.isArray(q.state.data));
      expect((query?.state.data as Array<{id:string}> | undefined)?.map(row => row.id)).toEqual(["cup-social"]);
    });
  });
  it('starts the event query without resolving teams whose grants already identify their club', async () => {
    eventsRoutedToIcp = true;
    getLiveAccountRosterScopeMock.mockResolvedValue({ teamIds: [], clubIds: [], childIds: [] });
    scheduleMocks.grants.mockResolvedValue([{ club: ['g1'], team: ['known-team'], role: 'player' }]);
    getLiveTeamMock.mockImplementation(() => new Promise(() => {}));
    const client = renderPage();
    await waitFor(() => expect(client.getQueryCache().getAll().some(query =>
      query.queryKey[0] === 'events' && query.queryKey[1] === 'icp-member-schedule' && query.state.data !== undefined,
    )).toBe(true));
    expect(scheduleMocks.events).toHaveBeenCalled();
  });
  it.each(['icp', 'supabase'])('event-type filters reuse loaded %s events and fixtures', async (mode) => {
    eventsRoutedToIcp = mode === 'icp';
    const types = ['training', 'game', 'social'];
    const tomorrow = Date.now() + 86400000;
    if (eventsRoutedToIcp) {
      scheduleMocks.grants.mockResolvedValue([{ club: ['club-1'], team: [], role: 'club_member' }]);
      getLiveAccountRosterScopeMock.mockResolvedValue({ teamIds: [], clubIds: [], childIds: [] });
      scheduleMocks.events.mockResolvedValue(types.map(type => ({ id: type, title: `${type} event`, event_type: type,
        starts_at_ms: BigInt(tomorrow), ends_at_ms: BigInt(tomorrow + 3600000), updated_at_ms: BigInt(Date.now()), deleted: false,
        club_id: 'club-1', team_id: [], address: [], location: [], mini_league_id: [], cancelled: false, series_id: [], opponent: [], description: '' })));
      scheduleMocks.profile.mockResolvedValue([{ name: 'Cats', sport: [] }]);
    } else {
      supabaseRoleRows = [{ role: 'club_member', club_id: 'club-1', team_id: null }];
      localStorage.setItem('ignite_schedule_memberships_v1:principal-abc', JSON.stringify({ roles: [{ role: 'club_member', club_id: 'club-1', team_id: null }], teamIds: [], clubIds: ['club-1'], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [], isAppAdmin: false }));
      supabaseEventRows = types.map(type => ({ id: type, title: `${type} event`, type, event_date: new Date(tomorrow).toISOString(),
        club_id: 'club-1', team_id: null, mini_league_id: null, is_cancelled: false, is_recurring: false, clubs: { name: 'Cats', sport: null } }));
    }
    const client = renderPage();
    await screen.findByText('training event');
    await waitFor(() => expect(client.getQueryCache().getAll().filter(query => query.queryKey[0] === 'events' || query.queryKey[0] === 'icp-schedule-fixtures').every(query => query.state.fetchStatus === 'idle')).toBe(true));
    const reads = eventsRoutedToIcp ? scheduleMocks.events.mock.calls.length : queriedTables.filter(table => table === 'events').length;
    const fixtureReads = competitionMocks.listLivePublicCompetitions.mock.calls.length;
    for (const type of types) {
      fireEvent.click(screen.getByRole('button', { name: `Filter by ${type}` }));
      expect(screen.getByText(`${type} event`)).toBeInTheDocument();
      for (const other of types.filter(value => value !== type)) expect(screen.queryByText(`${other} event`)).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Filter by all events' }));
    for (const type of types) expect(screen.getByText(`${type} event`)).toBeInTheDocument();
    const inventory = client.getQueryCache().getAll().filter(query => query.queryKey[0] === 'events' || query.queryKey[0] === 'icp-schedule-fixtures');
    fireEvent.click(screen.getByRole('button', { name: 'Calendar view' }));
    expect(screen.getByRole('button', { name: 'Calendar view' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(client.getQueryCache().getAll().filter(query => query.queryKey[0] === 'events' || query.queryKey[0] === 'icp-schedule-fixtures')).toEqual(inventory));
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    for (const type of types) expect(screen.getByText(`${type} event`)).toBeInTheDocument();
    expect(eventsRoutedToIcp ? scheduleMocks.events.mock.calls.length : queriedTables.filter(table => table === 'events').length).toBe(reads);
    expect(competitionMocks.listLivePublicCompetitions.mock.calls.length).toBe(fixtureReads);
    expect(reads).toBeGreaterThan(0);
  });
  it('renders ready Group 1 events before Group 2 or the Group 1 profile finishes', async () => {
    eventsRoutedToIcp = true;
    scheduleMocks.grants.mockResolvedValue([{ club: ['g1'], team: [], role: 'club_member' }, { club: ['g2'], team: [], role: 'club_member' }]);
    const event = { id: 'g1-event', title: 'Ready training', event_type: 'training', starts_at_ms: BigInt(Date.now() + 86400000),
      ends_at_ms: BigInt(Date.now() + 90000000), updated_at_ms: BigInt(Date.now()), deleted: false, club_id: 'g1', team_id: [],
      address: [], location: [], mini_league_id: [], cancelled: false, series_id: [], opponent: [], description: '' };
    let finishClub: ((value: unknown[]) => void) | undefined; let finishProfile: ((value: unknown[]) => void) | undefined;
    scheduleMocks.events.mockImplementation((_ctx, clubId) => clubId === 'g1' ? Promise.resolve([event]) : new Promise(resolve => { finishClub = resolve; }));
    scheduleMocks.profile.mockImplementation(() => new Promise(resolve => { finishProfile = resolve; }));
    const client = renderPage();
    await waitFor(() => expect(client.getQueryCache().getAll().some(query => query.queryKey[0] === 'events' &&
      (query.state.data as { events?: { id: string }[] } | undefined)?.events?.some(row => row.id === 'g1-event'))).toBe(true));
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    const schedule = client.getQueryCache().getAll().find(query => query.queryKey[0] === 'events' && query.queryKey[1] === 'icp-member-schedule' &&
      (query.state.data as { events?: { id: string }[] } | undefined)?.events?.some(row => row.id === 'g1-event'));
    expect(schedule?.state.fetchStatus).toBe('fetching');
    expect((schedule?.state.data as { incomplete: boolean }).incomplete).toBe(true);
    finishClub?.([]); finishProfile?.([{ name: 'Cats', sport: [] }]);
    await waitFor(() => expect((schedule?.state.data as { incomplete: boolean }).incomplete).toBe(false));
  });
  it('shows a ready public fixture while member club events are still pending', async () => {
    eventsRoutedToIcp = true;
    scheduleMocks.grants.mockResolvedValue([{ club: ['member-club'], team: [], role: 'club_member' }]);
    let finish: ((value: unknown[]) => void) | undefined;
    scheduleMocks.events.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    competitionMocks.listLivePublicCompetitions.mockResolvedValue([{ id: 'foreign-cup', club_id: 'foreign-host', name: 'Foreign Cup', status: 'open', visibility: 'public' }]);
    competitionMocks.listLiveCompetitionMatches.mockResolvedValue([{ id: 'foreign-match', home_team: 'home', away_team: 'away', scheduled_at_ms: [BigInt(Date.now() + 86400000)], status: 'scheduled', venue: [] }]);
    const client = renderPage();
    expect(await screen.findByText('Foreign Cup', { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(scheduleMocks.events).toHaveBeenCalledWith(expect.anything(), 'member-club', null));
    const members = client.getQueryCache().getAll().find(query => query.queryKey[0] === 'events' && query.queryKey[1] === 'icp-member-schedule' && query.state.fetchStatus === 'fetching');
    expect(members?.state.fetchStatus).toBe('fetching');
    expect(competitionMocks.listLiveCompetitionMatches).toHaveBeenCalledWith(expect.anything(), 'foreign-cup');
    finish?.([]);
    await waitFor(() => expect(members?.state.fetchStatus).toBe('idle'));
  });
  it('completes the member schedule without waiting for slow foreign-host discovery', async () => {
    eventsRoutedToIcp = true;
    let finish: ((value: unknown[]) => void) | undefined;
    competitionMocks.listLivePublicCompetitions.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const client = renderPage();
    await waitFor(() => expect(client.getQueryCache().getAll().some(query => query.queryKey[0] === 'events' && query.queryKey[1] === 'icp-member-schedule' && query.state.status === 'success')).toBe(true));
    expect(client.getQueryCache().getAll().find(query => query.queryKey[0] === 'icp-schedule-fixtures')?.state.fetchStatus).toBe('fetching');
    finish?.([]);
  });
  it('loads ordinary club scope while independent league discovery is still pending', async () => {
    eventsRoutedToIcp = true;
    let finish: ((rows: unknown[]) => void) | undefined;
    leagueDiscoveryMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const client = renderPage();
    await waitFor(() => expect(client.getQueryCache().getAll().some(query => query.queryKey[0] === 'user-memberships-for-events' && query.state.status === 'success')).toBe(true));
    expect(client.getQueryData(['icp-my-mini-leagues', 'principal-abc'])).toBeUndefined();
    expect(leagueDiscoveryMock).toHaveBeenCalledTimes(1);
    finish?.([]);
  });
  it("Supabase branch (not ICP-routed): queries child_guardians/children/child_team_assignments and never calls the ICP roster scope helper", async () => {
    eventsRoutedToIcp = false;
    renderPage();

    await waitFor(() => expect(queriedTables).toContain("child_guardians"));
    expect(queriedTables).toContain("children");
    expect(getLiveAccountRosterScopeMock).not.toHaveBeenCalled();
  });

  it("ICP branch (events routed to ICP): resolves roster-derived team ids via getLiveAccountRosterScope using the II principal, skipping the Supabase child tables", async () => {
    eventsRoutedToIcp = true;
    renderPage();

    await waitFor(() => expect(getLiveAccountRosterScopeMock).toHaveBeenCalledWith(expect.anything(), "principal-abc"));
    expect(queriedTables).not.toContain("child_guardians");
    expect(queriedTables).not.toContain("child_team_assignments");
  });

  it("shows public competition fixtures to an ordinary member without an organizer-club role", async () => {
    eventsRoutedToIcp = true;
    getLiveAccountRosterScopeMock.mockResolvedValue({ teamIds: [], clubIds: [], miniLeagueIds: [] });
    competitionMocks.listLivePublicCompetitions.mockResolvedValue([{
      id: "competition-public",
      club_id: "organizer-club",
      name: "Public Cup",
      status: "open",
      visibility: "public",
    }]);
    const scheduledAt = Date.now() + 24 * 60 * 60 * 1000;
    competitionMocks.listLiveCompetitionMatches.mockResolvedValue([{
      id: "fixture-public",
      home_team: "home-team",
      away_team: "away-team",
      scheduled_at_ms: [BigInt(scheduledAt)],
      status: "scheduled",
      venue: ["Main Ground"],
    }]);
    getLiveTeamMock.mockImplementation(async (_ctx: unknown, teamId: string) => [{
      id: teamId,
      name: teamId === "home-team" ? "Home FC" : "Away FC",
    }]);

    const queryClient = renderPage();

    await waitFor(() => expect(competitionMocks.listLivePublicCompetitions).toHaveBeenCalled());
    const eventsQuery = queryClient.getQueryCache().getAll().find((query) =>
      query.queryKey[0] === "events" && query.queryKey[1] === "icp-member-schedule",
    );
    expect(eventsQuery?.state.error).toBeNull();
    expect(await screen.findByText("Home FC vs Away FC")).toBeInTheDocument();
    expect(screen.getByText(/Public Cup/)).toBeInTheDocument();
    expect(competitionMocks.listLiveCompetitionMatches).toHaveBeenCalledWith(expect.anything(), "competition-public");
    expect(queriedTables).not.toContain("teams");
  });
});
