import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ClubArchivedTeamsSection } from "./ClubArchivedTeamsSection";

vi.mock("@/components/ArchiveTeamDialog", () => ({
  ArchiveTeamDialog: ({ teamName, trigger }: { teamName: string; trigger: React.ReactNode }) => (
    <div>
      Reinstate dialog for {teamName}
      {trigger}
    </div>
  ),
}));

const archivedTeams = [
  { id: "team-1", name: "Old Under 9s", level_age: "U9", season_label: "2024/25" },
  { id: "team-2", name: "Retired Firsts" },
];

function renderSection(teams = archivedTeams) {
  render(
    <MemoryRouter>
      <ClubArchivedTeamsSection clubId="club-1" archivedTeams={teams} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Archived Teams"));
}

describe("ClubArchivedTeamsSection", () => {
  it("renders nothing when there are no archived teams", () => {
    const { container } = render(
      <MemoryRouter>
        <ClubArchivedTeamsSection clubId="club-1" archivedTeams={[]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders each archived team with its season label and a reinstate control", () => {
    renderSection();
    expect(screen.getByText("Old Under 9s")).toBeInTheDocument();
    expect(screen.getByText("2024/25")).toBeInTheDocument();
    expect(screen.getByText("U9")).toBeInTheDocument();
    expect(screen.getByText("Reinstate dialog for Old Under 9s")).toBeInTheDocument();
    expect(screen.getByText("Old Under 9s").closest("a")).toHaveAttribute("href", "/teams/team-1");
  });

  it("shows the archived team count badge", () => {
    renderSection();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
