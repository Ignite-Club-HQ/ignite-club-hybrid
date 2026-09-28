import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeDashboardOverview } from "./HomeDashboardOverview";

vi.mock("@/components/HomeQuickActionsFab", () => ({
  HomeQuickActionsFab: () => <div>Mobile quick actions</div>,
}));
vi.mock("./DesktopActionBar", () => ({
  DesktopActionBar: () => <div>Desktop quick actions</div>,
}));
vi.mock("./HomeWelcomeGetStarted", () => ({
  HomeWelcomeGetStarted: ({ onFindOrJoin }: { onFindOrJoin: () => void }) => (
    <button onClick={onFindOrJoin}>Find or join</button>
  ),
}));
vi.mock("@/components/NextUpCarousel", () => ({
  NextUpCarousel: ({
    onReadyChange,
  }: {
    onReadyChange: (ready: boolean) => void;
  }) => <button onClick={() => onReadyChange(true)}>Next Up</button>,
}));
vi.mock("@/components/MyTeamsPremiumCarousel", () => ({
  MyTeamsPremiumCarousel: ({
    onReadyChange,
  }: {
    onReadyChange: (ready: boolean) => void;
  }) => <button onClick={() => onReadyChange(true)}>My Teams</button>,
}));
vi.mock("./ClubNewsSection", () => ({ default: () => null }));
vi.mock("./ClubLinksSection", () => ({ default: () => null }));
vi.mock("./HomeLoadingSkeletons", () => ({
  HomeInitialSkeleton: () => <div>Dashboard loading</div>,
  HomeMyTeamsSkeleton: () => null,
}));
vi.mock("./HomePitchBoardRuntime", () => ({
  HomeGameTimerRuntime: () => null,
}));
vi.mock("@/components/MiniLeagueGameWidgets", () => ({
  MiniLeagueGameWidgets: () => null,
}));
vi.mock("@/components/LazyMount", () => ({
  LazyMount: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/UpcomingClassesWidget", () => ({
  UpcomingClassesWidget: () => null,
}));
vi.mock("@/components/ContactClubButton", () => ({
  ContactClubButton: () => null,
}));

function renderOverview(
  overrides: Partial<Parameters<typeof HomeDashboardOverview>[0]> = {},
) {
  const props: Parameters<typeof HomeDashboardOverview>[0] = {
    firstName: "Alex",
    email: "alex@example.test",
    activeClubName: "Ignite FC",
    activeClubFilter: "club-1",
    isNewUserEmptyState: false,
    userRoles: [{ role: "club_admin", club_id: "club-1", team_id: "team-1" }],
    canAccessVault: true,
    isAppAdmin: false,
    hasProContext: true,
    showContent: true,
    events: [],
    eventsLoading: false,
    onNextUpReadyChange: vi.fn(),
    onMyTeamsReadyChange: vi.fn(),
    onInvite: vi.fn(),
    onJoinTeam: vi.fn(),
    onOpenVault: vi.fn(),
    editableTeams: [],
    readOnlyTeams: [],
    onOpenPitchBoard: vi.fn(),
    userId: undefined,
    onAccountRecovered: vi.fn(),
    memberInviteOpen: false,
    onMemberInviteOpenChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<HomeDashboardOverview {...props} />) };
}

describe("HomeDashboardOverview", () => {
  it("shows dashboard actions for an established user", () => {
    renderOverview();
    expect(screen.getByText("Mobile quick actions")).toBeInTheDocument();
    expect(screen.getByText("Desktop quick actions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Find or join" })).not.toBeInTheDocument();
  });

  it("shows onboarding instead of quick actions for a new user", () => {
    const { props } = renderOverview({ isNewUserEmptyState: true });
    fireEvent.click(screen.getByRole("button", { name: "Find or join" }));
    expect(props.onJoinTeam).toHaveBeenCalledOnce();
    expect(screen.queryByText("Desktop quick actions")).not.toBeInTheDocument();
  });

  it("opens Club Files by click and keyboard", () => {
    const { props } = renderOverview();
    const vault = screen.getByRole("button", { name: "Open club files" });
    fireEvent.click(vault);
    fireEvent.keyDown(vault, { key: "Enter" });
    fireEvent.keyDown(vault, { key: " " });
    expect(props.onOpenVault).toHaveBeenCalledTimes(3);
  });

  it("keeps the loading skeleton until child content is ready", () => {
    const { props } = renderOverview({ showContent: false });
    expect(screen.getByText("Dashboard loading")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next Up"));
    fireEvent.click(screen.getByText("My Teams"));
    expect(props.onNextUpReadyChange).toHaveBeenCalledWith(true);
    expect(props.onMyTeamsReadyChange).toHaveBeenCalledWith(true);
  });
});
