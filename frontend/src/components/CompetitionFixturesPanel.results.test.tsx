import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  from: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
  matches: [] as any[],
  mutationResult: { error: null as any },
  lastQuery: null as any,
  setLiveMatchResult: vi.fn(),
  updateLiveMatchDetails: vi.fn(),
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mocks.backend === "icp" ? providers.icp({ identity: {}, target: { alias: "test" } }) : providers.supabase(),
}));
vi.mock("@/live/features/competitions", () => ({
  setLiveMatchResult: (...args: unknown[]) => mocks.setLiveMatchResult(...args),
  updateLiveMatchDetails: (...args: unknown[]) => mocks.updateLiveMatchDetails(...args),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value, onChange }: any) => (
    <input aria-label="Venue" value={value} onChange={event => onChange(event.target.value)} />
  ),
}));
vi.mock("@tanstack/react-query", async importOriginal => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: any) => {
      if (queryKey[0] === "competition-matches") {
        return { data: mocks.matches, isLoading: false };
      }
      return { data: [], isLoading: false };
    },
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});

import { buildCompetitionLadderRows, CompetitionFixturesPanel } from "./CompetitionFixturesPanel";

function mutationQuery() {
  const query: any = {};
  query.upsert = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  Object.defineProperty(query, "then", {
    value: (resolve: any) => Promise.resolve(mocks.mutationResult).then(resolve),
  });
  mocks.lastQuery = query;
  return query;
}

const match = (overrides: Record<string, any> = {}) => ({
  id: "match-1",
  competition_id: "competition-1",
  home_team_id: "team-home",
  away_team_id: "team-away",
  home: { id: "team-home", name: "Riverside", logo_url: null },
  away: { id: "team-away", name: "Hilltown", logo_url: null },
  home_score: null,
  away_score: null,
  status: "scheduled",
  scheduled_at: "2026-07-25T10:00:00.000Z",
  round_number: 1,
  venue: "Riverside Park",
  pitch_number: "1",
  source: "manual",
  manually_overridden_at: null,
  ...overrides,
});

function renderPanel(props: { isAdmin?: boolean; source?: string } = {}) {
  return render(
    <MemoryRouter>
    <CompetitionFixturesPanel
      competitionId="competition-1"
      isAdmin={props.isAdmin ?? true}
      divisions={[]}
      entries={[]}
      source={props.source}
    />
    </MemoryRouter>
  );
}

async function editScores(home: string, away: string) {
  fireEvent.click(screen.getByRole("button", { name: /enter score|edit score/i }));
  const scoreInputs = screen.getAllByRole("spinbutton");
  expect(scoreInputs).toHaveLength(2);
  fireEvent.change(scoreInputs[0], { target: { value: home } });
  fireEvent.change(scoreInputs[1], { target: { value: away } });
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
}

describe("CompetitionFixturesPanel result management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backend = process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase";
    mocks.matches = [match()];
    mocks.mutationResult.error = null;
    mocks.lastQuery = null;
    mocks.rpc.mockImplementation(async () => mocks.mutationResult);
    mocks.from.mockImplementation(() => mutationQuery());
  });

  it.each(["competition hide", "division inherit", "division hide"])("labels masked %s results for members", () => {
    mocks.matches = [match({ status: "completed", home_score: null, away_score: null })];
    renderPanel({ isAdmin: false });
    expect(screen.getByText("Scores hidden")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enter score|edit score/i })).not.toBeInTheDocument();
  });

  it("shows manager scores and edit controls even for a hidden competition", () => {
    mocks.matches = [match({ status: "completed", home_score: 4, away_score: 2 })];
    renderPanel();
    expect(screen.queryByText("Scores hidden")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit score/i })).toBeInTheDocument();
  });

  it.each([null, []])("excludes masked signed-in ladder results (%j) with custom competition points", (masked) => {
    const entries = ["h", "a"].map(team_id => ({ team_id, status: "accepted", division_id: null }));
    const game = { status: "completed", home_team: "h", away_team: "a", home_score: masked, away_score: masked };
    const rows = buildCompetitionLadderRows(entries, [game, { ...game, home_score: 4, away_score: 2 }], new Map(), { win: 7, draw: 4, loss: 2 });
    expect(rows.find(r => r.team_id === "h")).toMatchObject({ played: 1, points: 7, goals_for: 4 });
    expect(rows.find(r => r.team_id === "a")).toMatchObject({ played: 1, points: 2 });
  });

  it("renders visible division-show results for a member", () => {
    mocks.matches = [match({ status: "completed", home_score: 4, away_score: 2 })];
    renderPanel({ isAdmin: false });
    expect(screen.queryByText("Scores hidden")).not.toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enter score|edit score/i })).not.toBeInTheDocument();
  });

  it("does not expose result controls to a non-admin", () => {
    renderPanel({ isAdmin: false });

    expect(screen.queryByRole("button", { name: /enter score|edit score/i })).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not expose local result controls for a PlayHQ-managed competition", () => {
    renderPanel({ source: "playhq" });

    expect(screen.queryByRole("button", { name: /enter score|edit score/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fixture settings/i })).not.toBeInTheDocument();
  });

  it("renders external-source and local-override indicators without hiding local controls", () => {
    mocks.matches = [match({
      source: "playhq",
      manually_overridden_at: "2026-07-20T09:00:00.000Z",
    })];
    renderPanel();

    const sourceBadge = screen.getByText("playhq · local");
    expect(sourceBadge).toHaveAttribute("title", "Synced from playhq · locally overridden");
    expect(screen.getByRole("button", { name: /enter score/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fixture settings/i })).toBeInTheDocument();
  });

  it("renders status, schedule and compact venue/pitch metadata", () => {
    mocks.matches = [match({ status: "postponed", venue: "Riverside Park, Main Road", pitch_number: "2" })];
    renderPanel({ isAdmin: false });

    expect(screen.getByText("postponed")).toBeInTheDocument();
    expect(screen.getByText("Riverside Park · Pitch 2")).toBeInTheDocument();
    expect(screen.getByText("Riverside")).toBeInTheDocument();
    expect(screen.getByText("Hilltown")).toBeInTheDocument();
  });

  it("exposes all manual-fixture management actions from the settings control", async () => {
    renderPanel();
    fireEvent.pointerDown(screen.getByRole("button", { name: /fixture settings/i }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByText("Edit details")).toBeInTheDocument();
    expect(screen.getByText("Edit score")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("suppresses native long-press context menus and treats moved pointers as gestures", () => {
    renderPanel();
    const settings = screen.getByRole("button", { name: /fixture settings/i });
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    expect(settings.dispatchEvent(contextMenu)).toBe(false);

    fireEvent.pointerDown(settings, { clientX: 4, clientY: 4, button: 0, ctrlKey: false });
    expect(fireEvent.pointerUp(settings, { clientX: 24, clientY: 4, button: 0 })).toBe(false);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.runIf(supabaseMode)("saves both scores, completes the match, and refreshes fixtures and ladder", async () => {
    renderPanel();
    await editScores("3", "1");

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_competition_match_result", {
      p_match_id: "match-1", p_home_score: 3, p_away_score: 1, p_status: "completed",
    }));
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competition-matches", "competition-1"],
    }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competition-ladder", "competition-1"],
    });
  });

  it.runIf(supabaseMode)("keeps a match scheduled when only one score is entered", async () => {
    renderPanel();
    await editScores("2", "");

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_competition_match_result", expect.objectContaining({ p_status: "scheduled" })));
  });

  it.runIf(supabaseMode)("reverts a completed match to scheduled when its scores are cleared", async () => {
    mocks.matches = [match({ home_score: 2, away_score: 1, status: "completed" })];
    renderPanel();
    await editScores("", "");

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_competition_match_result", expect.objectContaining({ p_status: "scheduled" })));
  });

  it.runIf(supabaseMode)("marks the first local edit of an externally sourced match as overridden", async () => {
    mocks.matches = [match({ source: "playhq", manually_overridden_at: null })];
    renderPanel();
    await editScores("1", "0");

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_competition_match_result", expect.objectContaining({ p_status: "completed" })));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Match updated",
      description: expect.stringMatching(/locally overridden/i),
    }));
  });

  it.runIf(supabaseMode)("does not replace the original override timestamp on later edits", async () => {
    mocks.matches = [match({
      source: "playhq",
      manually_overridden_at: "2026-07-20T09:00:00.000Z",
    })];
    renderPanel();
    await editScores("1", "1");

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("manually_overridden_at");
  });

  it.runIf(supabaseMode)("reports a rejected score update without invalidating successful caches", async () => {
    mocks.mutationResult.error = { message: "result update denied" };
    renderPanel();
    await editScores("3", "2");

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not save",
      description: "result update denied",
      variant: "destructive",
    }));
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it.runIf(supabaseMode)("keeps a rejected score edit retryable and invalidates only after the retry succeeds", async () => {
    mocks.mutationResult.error = { message: "temporary failure" };
    renderPanel();
    await editScores("3", "2");
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not save",
    })));
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();

    mocks.mutationResult.error = null;
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competition-matches", "competition-1"],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competition-ladder", "competition-1"],
    });
  });

  it.runIf(!supabaseMode)("saves a complete result through competition_domain and refreshes fixture caches", async () => {
    mocks.setLiveMatchResult.mockResolvedValue(undefined);
    renderPanel();
    await editScores("3", "1");

    await waitFor(() => expect(mocks.setLiveMatchResult).toHaveBeenCalledWith(
      { identity: {}, target: { alias: "test" } },
      "match-1",
      3,
      1,
      expect.any(Number),
    ));
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["competition-matches", "competition-1"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["competition-ladder", "competition-1"] });
  });

  it.runIf(!supabaseMode)("rejects a partial result without mutating fixture details", async () => {
    renderPanel();
    await editScores("2", "");

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not save",
      description: "Both scores are required to update a result on ICP.",
      variant: "destructive",
    })));
    expect(mocks.setLiveMatchResult).not.toHaveBeenCalled();
    expect(mocks.updateLiveMatchDetails).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it.runIf(!supabaseMode)("keeps a rejected canister score edit retryable and invalidates only after retry succeeds", async () => {
    mocks.setLiveMatchResult
      .mockRejectedValueOnce(new Error("temporary result failure"))
      .mockResolvedValueOnce(undefined);
    renderPanel();
    await editScores("3", "2");

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not save",
      description: "temporary result failure",
      variant: "destructive",
    }));
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.setLiveMatchResult).toHaveBeenCalledTimes(2));
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["competition-matches", "competition-1"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["competition-ladder", "competition-1"] });
  });
});
