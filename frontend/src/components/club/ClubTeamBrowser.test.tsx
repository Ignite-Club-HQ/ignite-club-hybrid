import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ClubTeamBrowser } from "./ClubTeamBrowser";

const teams = [
  { id: "junior", name: "U10 Blue", level_age: "U10", team_type: "junior" },
  { id: "senior", name: "Seniors", level_age: "Senior", team_type: "senior" },
  { id: "mixed", name: "Mixed XI", team_type: "mixed" },
];

function renderBrowser(overrides: Partial<ComponentProps<typeof ClubTeamBrowser>> = {}) {
  const props = {
    clubId: "club-1",
    classModeEnabled: false,
    isAdmin: false,
    teams,
    userTeamIds: ["junior"],
    teamSubscriptions: [],
    clubSubscription: null,
    teamFilter: "all" as const,
    yearLevelFilter: "all",
    searchQuery: "",
    onTeamFilterChange: vi.fn(),
    onYearLevelFilterChange: vi.fn(),
    onSearchQueryChange: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <ClubTeamBrowser {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe("ClubTeamBrowser", () => {
  it("groups unfiltered teams and preserves membership and Pro badges", () => {
    renderBrowser({
      teamSubscriptions: [{ team_id: "senior", is_pro: true }],
    });
    expect(screen.getByText("Junior Teams")).toBeInTheDocument();
    expect(screen.getByText("Senior Teams")).toBeInTheDocument();
    expect(screen.getByText("My Team")).toBeInTheDocument();
    expect(screen.getByText("PRO")).toBeInTheDocument();
    expect(screen.getByText("U10 Blue").closest("a")).toHaveAttribute("href", "/teams/junior");
  });

  it("sends filter, year-level, and search changes through route-owned callbacks", () => {
    const props = renderBrowser({ teamFilter: "junior" });
    fireEvent.click(screen.getAllByText("Senior")[0]);
    expect(props.onTeamFilterChange).toHaveBeenCalledWith("senior");
    expect(props.onYearLevelFilterChange).toHaveBeenCalledWith("all");

    fireEvent.change(screen.getByPlaceholderText("Search teams..."), { target: { value: "blue" } });
    expect(props.onSearchQueryChange).toHaveBeenCalledWith("blue");
  });

  it("uses class wording and renders an admin empty state", () => {
    renderBrowser({ teams: [], classModeEnabled: true, isAdmin: true });
    expect(screen.getByText("No teams yet")).toBeInTheDocument();
    expect(screen.getByText("Create First Team").closest("a")).toHaveAttribute("href", "/clubs/club-1/teams/new");
  });
});
