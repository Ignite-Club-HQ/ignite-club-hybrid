import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { TeamMembersSection, type TeamMembersRecord } from "./TeamMembersSection";

function renderSection(overrides: Partial<React.ComponentProps<typeof TeamMembersSection>> = {}) {
  const props: React.ComponentProps<typeof TeamMembersSection> = {
    teamId: "team-1",
    members: {},
    teamChildren: [],
    pendingInvites: [],
    memberRoleFilter: "all",
    adultPlayerCount: 0,
    isAdmin: true,
    isClubAdmin: false,
    currentUserId: "user-1",
    isMembersLoading: false,
    isMembersFetching: false,
    isChildrenLoading: false,
    isChildrenFetching: false,
    isMembersError: false,
    membersError: null,
    refetchMembers: vi.fn(),
    refetchChildren: vi.fn(),
    isSoccerClub: false,
    onOpenHeaderInvite: vi.fn(),
    onOpenAddPlayer: vi.fn(),
    onSelectChild: vi.fn(),
    onLinkChildToParent: vi.fn(),
    onMoveToTeam: vi.fn(),
    onAddRoleMember: vi.fn(),
    onSelectMember: vi.fn(),
    onInviteParentChild: vi.fn(),
    onOpenPositionSheet: vi.fn(),
    onRemoveMember: vi.fn(),
    ...overrides,
  };
  render(
    <Accordion type="multiple" defaultValue={["members"]}>
      <TeamMembersSection {...props} />
    </Accordion>,
  );
  return props;
}

describe("TeamMembersSection", () => {
  it("shows the empty state and invokes onOpenHeaderInvite from the invite button", () => {
    const props = renderSection();
    expect(screen.getByText("No members yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Invite Members/i }));
    expect(props.onOpenHeaderInvite).toHaveBeenCalledTimes(1);
  });

  it("shows a friendly error message and lets the user retry when the member fetch fails", () => {
    const props = renderSection({
      isMembersError: true,
      membersError: new Error("boom"),
    });
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(props.refetchMembers).toHaveBeenCalledTimes(1);
  });

  it("renders role-grouped members and calls onSelectMember when a member card is clicked", () => {
    const members: TeamMembersRecord = {
      "user-2": {
        profile: { id: "user-2", display_name: "Jane Coach", avatar_url: null },
        roles: [{ id: "role-1", role: "team_admin" }],
      },
    };
    const props = renderSection({ members });
    expect(screen.getByText("Team Admins")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Jane Coach"));
    expect(props.onSelectMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-2", displayName: "Jane Coach" }),
    );
  });

  it("refreshes members and children from the refresh button", () => {
    const props = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Refresh members list/i }));
    expect(props.refetchMembers).toHaveBeenCalledTimes(1);
    expect(props.refetchChildren).toHaveBeenCalledTimes(1);
  });
});
