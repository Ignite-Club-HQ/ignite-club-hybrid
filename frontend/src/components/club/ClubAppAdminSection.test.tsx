import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { ClubAppAdminSection } from "./ClubAppAdminSection";

function renderSection(overrides: Partial<Parameters<typeof ClubAppAdminSection>[0]> = {}) {
  const onToggleClubPro = vi.fn();
  const onToggleClubProFootball = vi.fn();
  render(
    <Accordion type="multiple" defaultValue={[]}>
      <ClubAppAdminSection
        isPro={false}
        isProFootball={false}
        isSoccerClub
        isTogglePending={false}
        plan={null}
        teamLimit={null}
        onToggleClubPro={onToggleClubPro}
        onToggleClubProFootball={onToggleClubProFootball}
        {...overrides}
      />
    </Accordion>,
  );
  fireEvent.click(screen.getByText("App Admin"));
  return { onToggleClubPro, onToggleClubProFootball };
}

describe("ClubAppAdminSection", () => {
  it("renders the Club Pro toggle", () => {
    renderSection();
    expect(screen.getByText("Club Pro")).toBeInTheDocument();
  });

  it("calls onToggleClubPro when the Club Pro switch is toggled", () => {
    const { onToggleClubPro } = renderSection();
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onToggleClubPro).toHaveBeenCalledWith(true);
  });

  it("shows the Club Pro Football toggle for soccer clubs", () => {
    renderSection({ isSoccerClub: true });
    expect(screen.getByText("Club Pro Football")).toBeInTheDocument();
  });

  it("hides the Club Pro Football toggle for non-soccer clubs", () => {
    renderSection({ isSoccerClub: false });
    expect(screen.queryByText("Club Pro Football")).not.toBeInTheDocument();
  });

  it("calls onToggleClubProFootball when its switch is toggled", () => {
    const { onToggleClubProFootball } = renderSection({ isSoccerClub: true });
    fireEvent.click(screen.getAllByRole("switch")[1]);
    expect(onToggleClubProFootball).toHaveBeenCalledWith(true);
  });

  it("disables both switches while a toggle is pending", () => {
    renderSection({ isTogglePending: true });
    for (const el of screen.getAllByRole("switch")) {
      expect(el).toBeDisabled();
    }
  });

  it("shows the plan and team limit when the club is Pro", () => {
    renderSection({ isPro: true, plan: "premium", teamLimit: 10 });
    expect(screen.getByText(/Plan: Premium/)).toBeInTheDocument();
    expect(screen.getByText(/Teams: 10/)).toBeInTheDocument();
  });

  it("shows Unlimited teams when teamLimit is null", () => {
    renderSection({ isPro: true, plan: "premium", teamLimit: null });
    expect(screen.getByText(/Teams: Unlimited/)).toBeInTheDocument();
  });

  it("hides the plan/team-limit line when the club is not Pro", () => {
    renderSection({ isPro: false });
    expect(screen.queryByText(/Plan:/)).not.toBeInTheDocument();
  });
});
