import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClubTeamFilter } from "./ClubTeamFilter";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
afterEach(cleanup);

describe("club-scoped gallery filter clearing", () => {
  it("clears the team without changing a hidden theme club", () => {
    const clubChange = vi.fn();
    const teamChange = vi.fn();
    render(<ClubTeamFilter expanded
      clubs={[{ id: "winter-cats", name: "Winter Cats" }, { id: "riverdogs", name: "Riverdogs" }]}
      teams={[{ id: "peanut", name: "Peanut", club_id: "winter-cats" }]}
      selectedClubId="winter-cats" selectedTeamId="peanut" showClubFilter={false}
      onClubChange={clubChange} onTeamChange={teamChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(teamChange).toHaveBeenCalledWith("all");
    expect(clubChange).not.toHaveBeenCalled();
  });

  it("still clears both selections when the club selector is available", () => {
    const clubChange = vi.fn();
    const teamChange = vi.fn();
    render(<ClubTeamFilter expanded
      clubs={[{ id: "winter-cats", name: "Winter Cats" }, { id: "riverdogs", name: "Riverdogs" }]}
      teams={[{ id: "peanut", name: "Peanut", club_id: "winter-cats" }]}
      selectedClubId="winter-cats" selectedTeamId="peanut"
      onClubChange={clubChange} onTeamChange={teamChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(clubChange).toHaveBeenCalledWith("all");
    expect(teamChange).toHaveBeenCalledWith("all");
  });
});