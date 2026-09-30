import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
vi.mock("@/live/features/events", () => ({
  getLiveAccountRosterScope: (...args: unknown[]) => getLiveAccountRosterScopeMock(...args),
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (feature: string, providers: any) =>
    feature === "events" && eventsRoutedToIcp
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
vi.mock("@/hooks/useEventViews", () => ({ useUserEventViews: () => ({ data: [] }) }));
vi.mock("@/hooks/useScheduleBroadcastListener", () => ({ useScheduleBroadcastListener: () => {} }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: null, setActiveClubTheme: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/components/events/EventCard", () => ({ EventCard: () => null }));
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
function makeQueryBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    then: (resolve: any) => resolve({ data: [], error: null }),
  };
  return builder;
}
const fromMock = vi.fn((table: string) => {
  queriedTables.push(table);
  return makeQueryBuilder();
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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/events"]}>
        <EventsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  eventsRoutedToIcp = false;
  getLiveAccountRosterScopeMock.mockReset();
  getLiveAccountRosterScopeMock.mockResolvedValue({ teamIds: ["icp-team-1"], clubIds: [], miniLeagueIds: [] });
  fromMock.mockClear();
  queriedTables.length = 0;
});

describe("EventsPage roster-derived team scope routing", () => {
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
});
