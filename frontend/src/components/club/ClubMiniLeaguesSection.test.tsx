import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ClubMiniLeaguesSection } from "./ClubMiniLeaguesSection";

const miniLeagues = [
  { id: "league-1", name: "U10 Ability League", description: "Weekly ability-based fixtures" },
  { id: "league-2", name: "U12 Ability League" },
];

function renderSection(overrides: Partial<Parameters<typeof ClubMiniLeaguesSection>[0]> = {}) {
  render(
    <MemoryRouter>
      <ClubMiniLeaguesSection clubId="club-1" isAdmin={false} miniLeagues={miniLeagues} {...overrides} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Mini Leagues"));
}

describe("ClubMiniLeaguesSection", () => {
  it("renders each mini league with a link to its detail page", () => {
    renderSection();
    expect(screen.getByText("U10 Ability League")).toBeInTheDocument();
    expect(screen.getByText("Weekly ability-based fixtures")).toBeInTheDocument();
    expect(screen.getByText("U10 Ability League").closest("a")).toHaveAttribute("href", "/mini-leagues/league-1");
  });

  it("shows the mini league count badge", () => {
    renderSection();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows a create-league action for admins only", () => {
    renderSection({ isAdmin: true });
    expect(screen.getByText("New Mini League").closest("a")).toHaveAttribute(
      "href",
      "/mini-leagues?clubId=club-1",
    );
  });

  it("hides the create-league action for non-admins", () => {
    renderSection({ isAdmin: false });
    expect(screen.queryByText("New Mini League")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no mini leagues", () => {
    renderSection({ miniLeagues: [] });
    expect(screen.getByText(/No mini leagues yet/)).toBeInTheDocument();
  });
});
