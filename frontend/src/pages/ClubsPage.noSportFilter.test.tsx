import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const themeState = vi.hoisted(() => ({ activeClubFilter: null as string | null }));

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

vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => false }));
vi.mock("@/live/featureRouter", () => ({
  mergeLists: (values: unknown[]) => values.flat(),
  withFeatureBackend: async (_feature: string, providers: { supabase: () => unknown }) => providers.supabase(),
}));
vi.mock("@/live/clubScope", () => ({ writeOnce: (scope: unknown) => scope }));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: async () => [] }));
vi.mock("@/live/features/club", () => ({
  getLiveClubProfile: async () => [],
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
});

describe("clubs page club list", () => {
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
