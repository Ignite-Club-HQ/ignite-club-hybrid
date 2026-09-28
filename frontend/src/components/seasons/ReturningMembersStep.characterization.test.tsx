import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReturningPlayer } from "./ReturningMembersStep";

const mocks = vi.hoisted(() => ({
  players: [] as any[],
  teams: [] as any[],
  loading: false,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: any) => options.queryKey?.[0] === "returning-players"
      ? { data: mocks.players, isLoading: mocks.loading }
      : { data: mocks.teams, isLoading: false },
  };
});

import { ReturningMembersStep } from "./ReturningMembersStep";

const players: ReturningPlayer[] = [
  { club_player_id: "player-1", display_name: "Alex Junior", date_of_birth: "2015-01-01", age_years: 12, previous_team_id: "old-u12", previous_team_name: "U12 Blue", membership_role: "player" },
  { club_player_id: "player-2", display_name: "Blair Junior", date_of_birth: "2015-02-01", age_years: 12, previous_team_id: "old-u12", previous_team_name: "U12 Blue", membership_role: "player" },
  { club_player_id: "player-3", display_name: "Casey Senior", date_of_birth: "2007-01-01", age_years: 19, previous_team_id: "old-senior", previous_team_name: "Senior A", membership_role: "player" },
];

function Harness({ initialAssignments = {}, initialSelected = new Set<string>() }: { initialAssignments?: Record<string, string | null>; initialSelected?: Set<string> }) {
  const [selected, setSelected] = useState(initialSelected);
  const [assignments, setAssignments] = useState(initialAssignments);
  return (
    <>
      <ReturningMembersStep
        sourceSeasonId="season-old"
        targetSeasonId="season-new"
        selectedIds={selected}
        onChange={setSelected}
        assignments={assignments}
        onAssignmentsChange={setAssignments}
      />
      <output data-testid="selected">{JSON.stringify(Array.from(selected).sort())}</output>
      <output data-testid="assignments">{JSON.stringify(assignments)}</output>
    </>
  );
}

describe("ReturningMembersStep characterization", () => {
  beforeEach(() => {
    mocks.players = players;
    mocks.teams = [
      { id: "new-u12", name: "U12 Blue" },
      { id: "new-u14", name: "U14 Blue" },
      { id: "new-senior", name: "Senior B" },
    ];
    mocks.loading = false;
  });

  it("groups returning players by their previous team", () => {
    render(<Harness />);
    expect(screen.getAllByText("U12 Blue").length).toBeGreaterThan(0);
    expect(screen.getByText("Senior A")).toBeInTheDocument();
    expect(screen.getByText("Alex Junior")).toBeInTheDocument();
    expect(screen.getByText("Casey Senior")).toBeInTheDocument();
  });

  it("seeds an exact same-name team and leaves unmatched grades unassigned", async () => {
    render(<Harness />);
    await waitFor(() => expect(JSON.parse(screen.getByTestId("assignments").textContent || "{}")).toEqual({
      "player-1": "new-u12",
      "player-2": "new-u12",
      "player-3": null,
    }));
  });

  it("preserves an administrator's explicit grade-up assignment", async () => {
    render(<Harness initialAssignments={{ "player-1": "new-u14" }} />);
    await waitFor(() => expect(JSON.parse(screen.getByTestId("assignments").textContent || "{}")).toEqual({
      "player-1": "new-u14",
      "player-2": "new-u12",
      "player-3": null,
    }));
  });

  it("selects and clears every returning player", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(JSON.parse(screen.getByTestId("selected").textContent || "[]")).toEqual(["player-1", "player-2", "player-3"]);
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByTestId("selected")).toHaveTextContent("[]");
  });

  it("selects and deselects a complete previous-team group without affecting others", () => {
    render(<Harness initialSelected={new Set(["player-3"])} />);
    const groupCheckbox = screen.getByRole("checkbox", { name: "Select all players from U12 Blue" });
    fireEvent.click(groupCheckbox);
    expect(JSON.parse(screen.getByTestId("selected").textContent || "[]")).toEqual(["player-1", "player-2", "player-3"]);
    fireEvent.click(groupCheckbox);
    expect(JSON.parse(screen.getByTestId("selected").textContent || "[]")).toEqual(["player-3"]);
  });

  it("filters by player name without changing selection state", () => {
    render(<Harness initialSelected={new Set(["player-1"])} />);
    fireEvent.change(screen.getByPlaceholderText("Search players…"), { target: { value: "Casey" } });
    expect(screen.getByText("Casey Senior")).toBeInTheDocument();
    expect(screen.queryByText("Alex Junior")).not.toBeInTheDocument();
    expect(screen.getByTestId("selected")).toHaveTextContent('["player-1"]');
  });

  it("shows selected players who still require a destination team", () => {
    render(<Harness initialSelected={new Set(["player-3"])} />);
    expect(screen.getByText("1 without a new team")).toBeInTheDocument();
  });

  it("handles a previous season with no returning players", () => {
    mocks.players = [];
    render(<Harness />);
    expect(screen.getByText("No players from the previous season to carry over.")).toBeInTheDocument();
  });
});
