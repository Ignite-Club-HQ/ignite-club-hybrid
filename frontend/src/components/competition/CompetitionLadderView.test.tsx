import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LadderView } from "./CompetitionLadderView";

const divisions = [
  { id: "div-1", name: "Division A", hide_ladder: false },
  { id: "div-2", name: "Division B", hide_ladder: false },
];

const rows = [
  { team_id: "t1", division_id: "div-1", teams: { name: "Alpha FC" }, played: 3, wins: 2, draws: 1, losses: 0, goal_diff: 4, points: 7 },
  { team_id: "t2", division_id: "div-1", teams: { name: "Bravo FC" }, played: 3, wins: 1, draws: 1, losses: 1, goal_diff: -1, points: 4 },
  { team_id: "t3", division_id: "div-2", teams: { name: "Charlie FC" }, played: 2, wins: 2, draws: 0, losses: 0, goal_diff: 3, points: 6 },
];

describe("LadderView", () => {
  it("renders a division card per group with team standings", () => {
    render(<LadderView rows={rows} divisions={divisions} />);
    expect(screen.getByText("Division A")).toBeInTheDocument();
    expect(screen.getByText("Division B")).toBeInTheDocument();
    expect(screen.getByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByText("Charlie FC")).toBeInTheDocument();
  });

  it("shows the division filter when more than one division is present", () => {
    render(<LadderView rows={rows} divisions={divisions} />);
    expect(screen.getByText("All divisions")).toBeInTheDocument();
  });

  it("hides the division filter when only one division is present", () => {
    const singleDivisionRows = rows.filter((r) => r.division_id === "div-1");
    render(<LadderView rows={singleDivisionRows} divisions={divisions} />);
    expect(screen.queryByText("All divisions")).not.toBeInTheDocument();
  });

  it("shows a team-filter sheet trigger when more than one team is present", () => {
    render(<LadderView rows={rows} divisions={divisions} />);
    expect(screen.getByText("All teams")).toBeInTheDocument();
  });

  it("hides divisions marked hide_ladder from non-admins entirely", () => {
    const hiddenDivisions = [
      { id: "div-1", name: "Division A", hide_ladder: true },
      { id: "div-2", name: "Division B", hide_ladder: false },
    ];
    render(<LadderView rows={rows} divisions={hiddenDivisions} isAdmin={false} />);
    expect(screen.getByText("No standings match the current filter.")).toBeInTheDocument();
  });

  it("shows a Hidden badge for hidden divisions when viewed as admin", () => {
    const hiddenDivisions = [
      { id: "div-1", name: "Division A", hide_ladder: true },
      { id: "div-2", name: "Division B", hide_ladder: false },
    ];
    render(<LadderView rows={rows} divisions={hiddenDivisions} isAdmin />);
    const divisionACard = screen.getByText("Division A").closest("button")!;
    expect(within(divisionACard).getByText("Hidden")).toBeInTheDocument();
  });

  it("shows a not-started message for a division with no played matches", () => {
    const notStartedRows = [
      { team_id: "t1", division_id: "div-1", teams: { name: "Alpha FC" }, played: 0, wins: 0, draws: 0, losses: 0, goal_diff: 0, points: 0 },
    ];
    render(<LadderView rows={notStartedRows} divisions={divisions} />);
    expect(screen.getByText("No results entered yet. Rankings will appear once matches are completed.")).toBeInTheDocument();
  });
});
