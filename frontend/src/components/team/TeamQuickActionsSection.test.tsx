import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TeamQuickActionsSection } from "./TeamQuickActionsSection";

vi.mock("./TeamChatPreview", () => ({
  TeamChatPreview: () => <div>Chat Preview</div>,
}));

function renderSection(overrides: Partial<React.ComponentProps<typeof TeamQuickActionsSection>> = {}) {
  const onOpenPitchBoard = vi.fn();

  render(
    <MemoryRouter>
      <TeamQuickActionsSection
        teamId="team-1"
        isSubscriptionLoading={false}
        isTeamPro={false}
        isAppAdmin={false}
        isAdmin={true}
        isCoachOrAdmin={true}
        isClubAdmin={false}
        hasNearbySubsManagerDuty={false}
        showPitch={true}
        onPitchBoardClick={onOpenPitchBoard}
        {...overrides}
      />
    </MemoryRouter>,
  );

  return { onOpenPitchBoard };
}

describe("TeamQuickActionsSection", () => {
  it("renders the chat action and core tiles", () => {
    renderSection({ isTeamPro: true, isSubscriptionLoading: false });
    expect(screen.getByText("Chat Preview")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vault" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pitch Board" })).toBeInTheDocument();
  });

  it("invokes the pitch-board handoff with fresh members and children", async () => {
    const { onOpenPitchBoard } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Pitch Board" }));

    await waitFor(() => expect(onOpenPitchBoard).toHaveBeenCalledTimes(1));
  });

  it("locks media and vault when pro access is unavailable", () => {
    renderSection({ isTeamPro: false, isSubscriptionLoading: false, isAppAdmin: false });
    expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Media" })).not.toBeInTheDocument();
    expect(screen.getByText("Media").closest("[aria-disabled='true']")).toBeTruthy();
    expect(screen.getByText("Vault").closest("[aria-disabled='true']")).toBeTruthy();
  });
});
