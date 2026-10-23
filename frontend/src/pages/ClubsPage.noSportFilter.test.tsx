import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The clubs page must list every club the user belongs to. The club theme
 * picker is the only thing allowed to narrow that list — a sport (or any other)
 * filter silently hides clubs the user owns.
 */

const clubRows = [
  {
    id: "club-a",
    name: "Riverside Rovers",
    logo_url: null,
    description: null,
    sport: "Football",
    is_pro: false,
    created_by: null,
    primary_sponsor_id: null,
  },
  {
    id: "club-b",
    name: "Northern Netball",
    logo_url: null,
    description: null,
    sport: "Netball",
    is_pro: false,
    created_by: null,
    primary_sponsor_id: null,
  },
];

const roleRows = [
  { user_id: "principal-abc", club_id: "club-a", team_id: null, role: "club_admin" },
  { user_id: "principal-abc", club_id: "club-b", team_id: null, role: "member" },
];

const themeState = vi.hoisted(() => ({ activeClubFilter: null as string | null, icp: false, profile: vi.fn() }));

vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({
    activeClubFilter: themeState.activeClubFilter,
    setActiveClubTheme: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "principal-abc", email: "member@example.com" }, profile: null }),
  useOptionalAuth: () => ({ user: null, sessionRestoration: "signed-out" }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSponsorAnalytics", () => ({
  useSponsorAnalytics: () => ({ trackView: vi.fn(), trackClick: vi.fn() }),
}));

vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => themeState.icp }));
vi.mock('@/live/membershipRouting', () => ({ readMembershipInScope: (ctx: unknown, _scope: unknown, read: (ctx: unknown) => unknown) => read(ctx) }));
vi.mock('@/live/accountDiscovery', () => ({ readDiscoveredRemovedClubs: async () => [] }));
vi.mock("@/live/featureRouter", () => ({
  mergeLists: (values: unknown[]) => values.flat(),
  withFeatureBackend: async (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) => themeState.icp ? providers.icp({}) : providers.supabase(),
}));
vi.mock("@/live/clubScope", () => ({ writeOnce: (scope: unknown) => scope }));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: async () => roleRows.map(row => ({ role: row.role, club: [row.club_id], team: [] })) }));
vi.mock("@/live/features/club", () => ({
  getLiveClubProfile: (...args: unknown[]) => themeState.profile(...args),
  getLiveClubSubscription: async () => null,
  listLiveSponsors: async () => [],
  listLiveMyRemovedClubs: async () => [],
  restoreLiveClub: async () => {},
  deleteLiveClubPermanent: async () => {},
}));

vi.mock("@/lib/sportEmojis", () => ({ getSportEmoji: () => "", SPORT_EMOJIS: {} }));
vi.mock("@/lib/clubSetupLocalState", () => ({ clearClubSetupLocalState: () => {} }));
vi.mock("@/lab/membershipQueryKeys", () => ({
  membershipKeys: { userRolesFor: (userId?: string) => ["user-roles", userId] },
}));
vi.mock("@/components/club/ConfirmPurgeDialog", () => ({ ConfirmPurgeDialog: () => null }));

// supabase: answer every query with the rows for its table. The clubs table is
// queried twice (the live list and the "recently removed" list), so the select
// column list decides which one is being answered.
function rowsFor(table: string, selectColumns: string) {
  if (table === "clubs") return selectColumns.includes("deleted_at") ? [] : clubRows;
  if (table === "user_roles") return roleRows;
  return [];
}

function makeBuilder(table: string) {
  let selectColumns = "";
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "gte", "order", "in", "or", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      if (method === "select") selectColumns = String(args[0] ?? "");
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) =>
    resolve({ data: rowsFor(table, selectColumns), error: null });
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn() },
  },
}));

import ClubsPage from "./ClubsPage";

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/clubs"]}>
        <ClubsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  themeState.activeClubFilter = null;
  themeState.icp = false;
  themeState.profile.mockReset();
});

describe("clubs page club list", () => {
  it('shows ready ICP clubs before the other group replies without persisting partial rows', async () => {
    themeState.icp = true;
    let finish: ((rows: unknown[]) => void) | undefined;
    const profile = (index: number) => [{ ...clubRows[index], logo_url: [], description: [], sport: [clubRows[index].sport], deleted_at_ms: [] }];
    themeState.profile.mockImplementation(async (_ctx, id) => id === 'club-a' ? profile(0) : new Promise(resolve => { finish = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(client);
    await screen.findByText('Riverside Rovers');
    expect(screen.queryByText('Northern Netball')).toBeNull();
    expect(client.getQueryData(['clubs'])).toBeUndefined();
    await act(async () => finish?.(profile(1)));
    await screen.findByText('Northern Netball');
    expect((client.getQueryData(['clubs']) as { id: string }[]).map(row => row.id)).toEqual(['club-a', 'club-b']);
    client.clear();
  });
  it('keeps the previous complete ICP list when one club fails instead of replacing it with one club', async () => {
    themeState.icp = true;
    themeState.profile.mockImplementation(async (_ctx, id) => {
      if (id === 'club-b') throw new Error('Group unavailable');
      return [{ ...clubRows[0], logo_url: [], description: [], sport: ['Football'], deleted_at_ms: [] }];
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['clubs'], clubRows);
    renderPage(client);
    await screen.findByText('Some clubs could not be loaded.');
    expect(screen.getByText('Northern Netball')).toBeTruthy();
    expect(client.getQueryData(['clubs'])).toEqual(clubRows);
    client.clear();
  });
  it("lists clubs of every sport the user belongs to", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Riverside Rovers")).toBeTruthy());
    expect(screen.getByText("Northern Netball")).toBeTruthy();
  });

  it("narrows the list only when the club theme picker is active", async () => {
    themeState.activeClubFilter = "club-a";
    renderPage();
    await waitFor(() => expect(screen.getByText("Riverside Rovers")).toBeTruthy());
    expect(screen.queryByText("Northern Netball")).toBeNull();
  });
});
