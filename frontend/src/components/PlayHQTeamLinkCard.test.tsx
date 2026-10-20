import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  from: vi.fn(),
  clubResult: Promise.resolve({ data: null, error: null }),
  getLiveClubProfile: vi.fn(),
  getLiveTeam: vi.fn(),
  saveLiveTeam: vi.fn(),
  listLivePlayHQCompetitions: vi.fn(),
  listLivePlayHQFixtures: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, handlers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mocks.mode === "icp" ? handlers.icp({}) : handlers.supabase(),
}));
vi.mock("@/live/features/club", () => ({
  getLiveClubProfile: mocks.getLiveClubProfile,
  getLiveTeam: mocks.getLiveTeam,
  saveLiveTeam: mocks.saveLiveTeam,
}));
vi.mock("@/live/features/events", () => ({
  listLivePlayHQCompetitions: mocks.listLivePlayHQCompetitions,
  listLivePlayHQFixtures: mocks.listLivePlayHQFixtures,
}));

import { PlayHQTeamLinkCard } from "./PlayHQTeamLinkCard";

function queryResult(table: string) {
  if (table === "clubs") return mocks.clubResult;
  if (table === "teams") {
    return Promise.resolve({
      data: {
        playhq_team_id: null,
        playhq_competition_id: null,
        playhq_auto_create_events: false,
      },
      error: null,
    });
  }
  return Promise.resolve({ data: [], error: null });
}

function queryFor(table: string) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "single", "maybeSingle", "update"]) {
    query[method] = vi.fn(() => query);
  }
  Object.defineProperty(query, "then", {
    value: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
      queryResult(table).then(resolve, reject),
  });
  return query;
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PlayHQTeamLinkCard teamId="team-1" clubId="club-1" />
    </QueryClientProvider>,
  );
}

describe("PlayHQTeamLinkCard hook-order safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLiveClubProfile.mockReset();
    mocks.getLiveTeam.mockReset();
    mocks.saveLiveTeam.mockReset();
    mocks.listLivePlayHQCompetitions.mockReset();
    mocks.listLivePlayHQFixtures.mockReset();
    mocks.from.mockImplementation((table: string) => queryFor(table));
  });

  it.runIf(mocks.mode === "supabase")("can move from the loading gate to a configured PlayHQ card without changing hook order", async () => {
    let resolveClub!: (value: { data: unknown; error: null }) => void;
    mocks.clubResult = new Promise((resolve) => {
      resolveClub = resolve;
    });

    renderCard();
    expect(screen.queryByText("PlayHQ Link")).not.toBeInTheDocument();

    resolveClub({
      data: { playhq_tenant: "tenant", playhq_org_id: "organisation" },
      error: null,
    });

    expect(await screen.findByText("PlayHQ Link")).toBeInTheDocument();
    expect(mocks.from).toHaveBeenCalledWith("teams");
    expect(mocks.from).toHaveBeenCalledWith("competitions");
  });

  it.runIf(mocks.mode === "supabase")("keeps the card and all downstream reads disabled for an unconfigured club", async () => {
    mocks.clubResult = Promise.resolve({
      data: { playhq_tenant: null, playhq_org_id: null },
      error: null,
    });

    renderCard();

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("clubs"));
    expect(screen.queryByText("PlayHQ Link")).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalledWith("teams");
    expect(mocks.from).not.toHaveBeenCalledWith("competitions");
    expect(mocks.from).not.toHaveBeenCalledWith("competition_matches");
  });

  it.runIf(mocks.mode === "icp")("loads configured club, team, and competition data through canister adapters", async () => {
    mocks.getLiveClubProfile.mockResolvedValue([{
      playhq_tenant: ["tenant"],
      playhq_org_id: ["organisation"],
    }]);
    mocks.getLiveTeam.mockResolvedValue([{
      playhq_team_id: [],
      playhq_competition_id: [],
      playhq_auto_create_events: false,
    }]);
    mocks.listLivePlayHQCompetitions.mockResolvedValue([]);

    renderCard();

    expect(await screen.findByText("PlayHQ Link")).toBeInTheDocument();
    await waitFor(() => expect(mocks.listLivePlayHQCompetitions).toHaveBeenCalledWith({}, "tenant", "organisation"));
    expect(mocks.getLiveTeam).toHaveBeenCalledWith({}, "team-1");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.runIf(mocks.mode === "icp")("keeps the card hidden when the club has no PlayHQ configuration", async () => {
    mocks.getLiveClubProfile.mockResolvedValue([{
      playhq_tenant: [],
      playhq_org_id: [],
    }]);
    renderCard();
    await waitFor(() => expect(mocks.getLiveClubProfile).toHaveBeenCalledWith({}, "club-1"));
    expect(screen.queryByText("PlayHQ Link")).not.toBeInTheDocument();
    expect(mocks.getLiveTeam).not.toHaveBeenCalled();
    expect(mocks.listLivePlayHQCompetitions).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.runIf(mocks.mode === "icp")("keeps team and competition reads gated while club configuration is loading", async () => {
    let resolveClub!: (value: any[]) => void;
    mocks.getLiveClubProfile.mockReturnValueOnce(new Promise((resolve) => {
      resolveClub = resolve;
    }));
    renderCard();

    expect(mocks.getLiveClubProfile).toHaveBeenCalledWith({}, "club-1");
    expect(screen.queryByText("PlayHQ Link")).not.toBeInTheDocument();
    expect(mocks.getLiveTeam).not.toHaveBeenCalled();
    expect(mocks.listLivePlayHQCompetitions).not.toHaveBeenCalled();

    resolveClub([{ playhq_tenant: ["tenant"], playhq_org_id: ["organisation"] }]);
    expect(await screen.findByText("PlayHQ Link")).toBeInTheDocument();
    expect(mocks.getLiveTeam).toHaveBeenCalledWith({}, "team-1");
  });
});
