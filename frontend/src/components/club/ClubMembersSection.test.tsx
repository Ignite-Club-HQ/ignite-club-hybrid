import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClubMembersSection } from "./ClubMembersSection";

vi.mock("@/components/AddClubAdminSheet", () => ({
  default: ({ clubName }: { clubName: string }) => <div>Add admin to {clubName}</div>,
}));

vi.mock("@/components/PendingInviteCard", () => ({
  default: ({ invite }: { invite: { invited_label: string | null } }) => (
    <div>Pending invite: {invite.invited_label}</div>
  ),
}));

const clubMembers = {
  "user-1": {
    profile: { id: "user-1", display_name: "Alex Admin", avatar_url: null },
    roles: [{ id: "role-1", role: "club_admin", scopeName: "Riverside FC", teamId: null, teamName: null }],
  },
  "user-2": {
    profile: { id: "user-2", display_name: "Jamie Coach", avatar_url: null },
    roles: [{ id: "role-2", role: "coach", scopeName: "U10 Blue", teamId: "team-1", teamName: "U10 Blue" }],
  },
};

function renderSection(overrides: Partial<ComponentProps<typeof ClubMembersSection>> = {}) {
  const props = {
    clubId: "club-1",
    clubName: "Riverside FC",
    isAdmin: false,
    clubMembers,
    isMembersLoading: false,
    isMembersError: false,
    membersError: null,
    onRetry: vi.fn(),
    pendingInvites: [],
    searchQuery: "",
    onSearchQueryChange: vi.fn(),
    displayCount: 10,
    onShowMore: vi.fn(),
    ...overrides,
  };
  render(<ClubMembersSection {...props} />);
  return props;
}

describe("ClubMembersSection", () => {
  it("renders members with role badges and shows the admin invite control", async () => {
    renderSection({ isAdmin: true });
    expect(screen.getByText("Alex Admin")).toBeInTheDocument();
    expect(screen.getByText("Jamie Coach")).toBeInTheDocument();
    expect(screen.getByText(/club admin.*Riverside FC/)).toBeInTheDocument();
    expect(await screen.findByText("Add admin to Riverside FC")).toBeInTheDocument();
  });

  it("hides the admin invite control for non-admins", () => {
    renderSection({ isAdmin: false });
    expect(screen.queryByText("Add admin to Riverside FC")).not.toBeInTheDocument();
  });

  it("forwards search input changes through the route-owned callback", () => {
    const props = renderSection();
    fireEvent.change(screen.getByPlaceholderText("Search members by name, role or team"), {
      target: { value: "jamie" },
    });
    expect(props.onSearchQueryChange).toHaveBeenCalledWith("jamie");
  });

  it("shows a no-results message when the search query matches nothing", () => {
    renderSection({ searchQuery: "nobody" });
    expect(screen.getByText('No members match "nobody"')).toBeInTheDocument();
  });

  it("renders pending invites above the member list", () => {
    renderSection({
      pendingInvites: [{ id: "invite-1", invited_label: "Taylor Parent" } as ComponentProps<
        typeof ClubMembersSection
      >["pendingInvites"][number]],
    });
    expect(screen.getByText("Pending invite: Taylor Parent")).toBeInTheDocument();
  });

  it("shows a show-more button when there are more entries than the display count", () => {
    const props = renderSection({ displayCount: 1 });
    const showMoreButton = screen.getByText(/Show more \(1 remaining\)/);
    fireEvent.click(showMoreButton);
    expect(props.onShowMore).toHaveBeenCalled();
  });

  it("renders a loading skeleton state", () => {
    renderSection({ isMembersLoading: true });
    expect(screen.queryByText("Alex Admin")).not.toBeInTheDocument();
  });

  it("renders a retry control on error with no cached members", () => {
    const props = renderSection({ isMembersError: true, clubMembers: {} });
    fireEvent.click(screen.getByText("Try again"));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("shows an empty state when there are no members or invites", () => {
    renderSection({ clubMembers: {}, pendingInvites: [] });
    expect(screen.getByText("No members yet")).toBeInTheDocument();
  });
});
