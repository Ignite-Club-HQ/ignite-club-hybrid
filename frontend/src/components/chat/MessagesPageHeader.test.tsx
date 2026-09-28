import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessagesPageHeader } from "./MessagesPageHeader";

function renderHeader(overrides: Partial<React.ComponentProps<typeof MessagesPageHeader>> = {}) {
  const props: React.ComponentProps<typeof MessagesPageHeader> = {
    isLoadingFreshData: false,
    hasCachedData: false,
    activeClubFilter: null,
    displayMemberClubCount: 2,
    hasLocalFilter: false,
    canShowRecap: false,
    hasAdminRoleButNoPro: false,
    upgradeClubId: null,
    adminTeamIds: [],
    onClearClubFilter: vi.fn(),
    onOpenClubFilter: vi.fn(),
    onOpenRecap: vi.fn(),
    onNavigateToScheduledMessages: vi.fn(),
    onOpenNewMessage: vi.fn(),
    onNavigateToUpgrade: vi.fn(),
    ...overrides,
  };
  render(<MessagesPageHeader {...props} />);
  return props;
}

describe("MessagesPageHeader", () => {
  it("routes header controls to their supplied callbacks", () => {
    const props = renderHeader({ canShowRecap: true });

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Recap all chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Scheduled messages" }));
    fireEvent.click(screen.getByRole("button", { name: "New message" }));

    expect(props.onOpenClubFilter).toHaveBeenCalledOnce();
    expect(props.onOpenRecap).toHaveBeenCalledOnce();
    expect(props.onNavigateToScheduledMessages).toHaveBeenCalledOnce();
    expect(props.onOpenNewMessage).toHaveBeenCalledOnce();
  });

  it("clears an active local filter instead of reopening the drawer", () => {
    const props = renderHeader({ hasLocalFilter: true });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(props.onClearClubFilter).toHaveBeenCalledOnce();
    expect(props.onOpenClubFilter).not.toHaveBeenCalled();
  });

  it("routes the Pro CTA to the club, team, or clubs fallback", () => {
    const clubProps = renderHeader({ hasAdminRoleButNoPro: true, upgradeClubId: "club-1" });
    fireEvent.click(screen.getByRole("button", { name: "Upgrade →" }));
    expect(clubProps.onNavigateToUpgrade).toHaveBeenCalledWith("/clubs/club-1/upgrade");

    const teamProps = renderHeader({ hasAdminRoleButNoPro: true, adminTeamIds: ["team-1"] });
    fireEvent.click(screen.getAllByRole("button", { name: "Upgrade →" })[1]);
    expect(teamProps.onNavigateToUpgrade).toHaveBeenCalledWith("/teams/team-1/upgrade");
  });
});
