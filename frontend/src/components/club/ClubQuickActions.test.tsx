import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ClubQuickActions } from "./ClubQuickActions";

describe("ClubQuickActions", () => {
  it("links Pro members to the club chat and vault", () => {
    render(
      <MemoryRouter>
        <ClubQuickActions clubId="club-1" classModeEnabled={false} hasProAccess />
      </MemoryRouter>,
    );
    expect(screen.getByText("Club Chat").closest("a")).toHaveAttribute("href", "/messages/club/club-1");
    expect(screen.getByText("Vault").closest("a")).toHaveAttribute("href", "/vault?club=club-1");
  });

  it("keeps free access actions visibly locked without destinations", () => {
    render(
      <MemoryRouter>
        <ClubQuickActions clubId="club-1" classModeEnabled hasProAccess={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Group Chat")).toBeInTheDocument();
    expect(screen.getAllByText("Pro")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /club chat|group chat|vault/i })).not.toBeInTheDocument();
  });
});
