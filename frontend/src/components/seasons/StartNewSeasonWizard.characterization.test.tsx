import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  onComplete: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock("./ReturningMembersStep", () => ({
  ReturningMembersStep: ({ targetSeasonId, onChange, onAssignmentsChange }: any) => (
    <div>
      <span>Returning target {targetSeasonId}</span>
      <button onClick={() => { onChange(new Set(["player-1", "player-2"])); onAssignmentsChange({ "player-1": "new-team-1", "player-2": null }); }}>Choose returning players</button>
    </div>
  ),
}));
vi.mock("./SeasonInviteStep", () => ({
  SeasonInviteStep: ({ targetSeasonId, seasonName }: any) => <div>Invite into {targetSeasonId} for {seasonName}</div>,
}));

import { StartNewSeasonWizard } from "./StartNewSeasonWizard";

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <StartNewSeasonWizard
        clubId="club-1"
        open
        onOpenChange={mocks.onOpenChange}
        currentSeason={{ id: "season-old", club_id: "club-1", name: "2026 Season", status: "active" } as any}
        onComplete={mocks.onComplete}
      />
    </QueryClientProvider>,
  );
  return { invalidate };
}

async function advanceToReturningPlayers() {
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("2026 Season archived"));
  await screen.findByLabelText("Season name");
  fireEvent.change(screen.getByLabelText("Season name"), { target: { value: "  2027 Season  " } });
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  await screen.findByText("Returning target season-new");
}

describe("StartNewSeasonWizard orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "duplicate_season_structure") return { data: "season-new", error: null };
      if (name === "carry_over_players_to_teams") return { data: 1, error: null };
      return { data: null, error: null };
    });
    mocks.from.mockImplementation(() => ({
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: "season-new" }, error: null }) })) })),
    }));
  });

  it("archives the current season before duplicating its structure", async () => {
    renderWizard();
    await advanceToReturningPlayers();
    expect(mocks.rpc.mock.calls.slice(0, 2)).toEqual([
      ["archive_season", { _season_id: "season-old" }],
      ["duplicate_season_structure", { _source_season_id: "season-old", _new_season_name: "2027 Season", _copy_staff: true }],
    ]);
  });

  it("does not advance when archiving fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "archive denied" } });
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("archive denied"));
    expect(screen.getByText("Archive current season")).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalledWith("duplicate_season_structure", expect.anything());
  });

  it("requires a non-empty new season name", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await screen.findByLabelText("Season name");
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(mocks.toastError).toHaveBeenCalledWith("Enter a season name");
    expect(mocks.rpc).not.toHaveBeenCalledWith("duplicate_season_structure", expect.anything());
  });

  it("does not advance when season duplication fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "duplicate_season_structure"
      ? { data: null, error: { message: "duplicate failed" } }
      : { data: null, error: null });
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await screen.findByLabelText("Season name");
    fireEvent.change(screen.getByLabelText("Season name"), { target: { value: "2027" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("duplicate failed"));
    expect(screen.getByLabelText("Season name")).toBeInTheDocument();
  });

  it("carries over only selected players that have explicit target teams", async () => {
    renderWizard();
    await advanceToReturningPlayers();
    fireEvent.click(screen.getByRole("button", { name: "Choose returning players" }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("carry_over_players_to_teams", {
      _target_season_id: "season-new",
      _assignments: [{ club_player_id: "player-1", team_id: "new-team-1" }],
    }));
    expect(await screen.findByText("Invite into season-new for 2027 Season")).toBeInTheDocument();
  });

  it("stops before invitations when player carry-over fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "duplicate_season_structure") return { data: "season-new", error: null };
      if (name === "carry_over_players_to_teams") return { data: null, error: { message: "mapping rejected" } };
      return { data: null, error: null };
    });
    renderWizard();
    await advanceToReturningPlayers();
    fireEvent.click(screen.getByRole("button", { name: "Choose returning players" }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("mapping rejected"));
    expect(screen.getByText(/Returning target/)).toBeInTheDocument();
  });

  it("publishes only after the mapping, invitation and review steps", async () => {
    const { invalidate } = renderWizard();
    await advanceToReturningPlayers();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await screen.findByText(/Invite into season-new/);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await screen.findByText("Review");
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await screen.findByRole("heading", { name: /Publish\s+2027 Season\s+\?/ });
    fireEvent.click(screen.getByRole("button", { name: /Publish/ }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("publish_season", { _season_id: "season-new" }));
    expect(mocks.rpc).toHaveBeenCalledWith("notify_season_published", { _season_id: "season-new" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["club-seasons", "club-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["current-season", "club-1"] });
    expect(mocks.onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not complete the wizard when publishing fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "duplicate_season_structure") return { data: "season-new", error: null };
      if (name === "publish_season") return { data: null, error: { message: "publish denied" } };
      return { data: 0, error: null };
    });
    renderWizard();
    await advanceToReturningPlayers();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /Publish/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("publish denied"));
    expect(mocks.onComplete).not.toHaveBeenCalled();
  });
});
