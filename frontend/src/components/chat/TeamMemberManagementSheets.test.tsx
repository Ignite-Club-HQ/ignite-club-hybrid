import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamMemberManagementSheets } from "./TeamMemberManagementSheets";

vi.mock("@/components/MemberDetailSheet", () => ({
  default: ({ open, onOpenChange, displayName, onAddRole, onRemove, onRemoveRole }: any) =>
    open ? (
      <div>
        <span>Member sheet for {displayName}</span>
        <button onClick={onAddRole}>Add role</button>
        <button onClick={onRemove}>Remove member</button>
        <button onClick={() => onRemoveRole({ id: "role-1", role: "coach" })}>Remove role</button>
        <button onClick={() => onOpenChange(false)}>Close member sheet</button>
      </div>
    ) : null,
}));

vi.mock("@/components/AddRoleToMemberDialog", () => ({
  default: ({ open, onOpenChange, userName }: any) =>
    open ? (
      <div>
        <span>Add role dialog for {userName}</span>
        <button onClick={() => onOpenChange(false)}>Close add role dialog</button>
      </div>
    ) : null,
}));

const baseMember = {
  userId: "user-1",
  displayName: "Jane Doe",
  avatarUrl: null,
  roles: [{ id: "role-1", role: "coach" }],
};

describe("TeamMemberManagementSheets", () => {
  it("renders nothing when no member is selected", () => {
    render(
      <TeamMemberManagementSheets
        teamId="team-1"
        teamName="Under 10s"
        clubId="club-1"
        currentUserId="user-2"
        selectedMember={null}
        onSelectedMemberChange={vi.fn()}
        addRoleMember={null}
        onAddRoleMemberChange={vi.fn()}
        onRemoveMember={vi.fn()}
        onRemoveRole={vi.fn()}
        onRoleDialogClosed={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Member sheet for/)).not.toBeInTheDocument();
  });

  it("renders the member detail sheet when a member is selected", async () => {
    render(
      <TeamMemberManagementSheets
        teamId="team-1"
        teamName="Under 10s"
        clubId="club-1"
        currentUserId="user-2"
        selectedMember={baseMember}
        onSelectedMemberChange={vi.fn()}
        addRoleMember={null}
        onAddRoleMemberChange={vi.fn()}
        onRemoveMember={vi.fn()}
        onRemoveRole={vi.fn()}
        onRoleDialogClosed={vi.fn()}
      />,
    );
    expect(await screen.findByText("Member sheet for Jane Doe")).toBeInTheDocument();
  });

  it("clears the selected member when the sheet closes", async () => {
    const onSelectedMemberChange = vi.fn();
    render(
      <TeamMemberManagementSheets
        teamId="team-1"
        teamName="Under 10s"
        clubId="club-1"
        currentUserId="user-2"
        selectedMember={baseMember}
        onSelectedMemberChange={onSelectedMemberChange}
        addRoleMember={null}
        onAddRoleMemberChange={vi.fn()}
        onRemoveMember={vi.fn()}
        onRemoveRole={vi.fn()}
        onRoleDialogClosed={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText("Close member sheet"));
    expect(onSelectedMemberChange).toHaveBeenCalledWith(null);
  });

  it("populates the add-role dialog from the selected member's roles", async () => {
    const onAddRoleMemberChange = vi.fn();
    render(
      <TeamMemberManagementSheets
        teamId="team-1"
        teamName="Under 10s"
        clubId="club-1"
        currentUserId="user-2"
        selectedMember={baseMember}
        onSelectedMemberChange={vi.fn()}
        addRoleMember={null}
        onAddRoleMemberChange={onAddRoleMemberChange}
        onRemoveMember={vi.fn()}
        onRemoveRole={vi.fn()}
        onRoleDialogClosed={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText("Add role"));
    expect(onAddRoleMemberChange).toHaveBeenCalledWith({
      userId: "user-1",
      userName: "Jane Doe",
      existingRoles: ["coach"],
    });
  });

  it("calls onRemoveMember and onRemoveRole from the member sheet", async () => {
    const onRemoveMember = vi.fn();
    const onRemoveRole = vi.fn();
    render(
      <TeamMemberManagementSheets
        teamId="team-1"
        teamName="Under 10s"
        clubId="club-1"
        currentUserId="user-2"
        selectedMember={baseMember}
        onSelectedMemberChange={vi.fn()}
        addRoleMember={null}
        onAddRoleMemberChange={vi.fn()}
        onRemoveMember={onRemoveMember}
        onRemoveRole={onRemoveRole}
        onRoleDialogClosed={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText("Remove member"));
    expect(onRemoveMember).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByText("Remove role"));
    expect(onRemoveRole).toHaveBeenCalledWith({ id: "role-1", role: "coach" });
  });

  it("renders the add-role dialog when an add-role member is set", async () => {
    render(
      <TeamMemberManagementSheets
        teamId="team-1"
        teamName="Under 10s"
        clubId="club-1"
        currentUserId="user-2"
        selectedMember={null}
        onSelectedMemberChange={vi.fn()}
        addRoleMember={{ userId: "user-1", userName: "Jane Doe", existingRoles: ["coach"] }}
        onAddRoleMemberChange={vi.fn()}
        onRemoveMember={vi.fn()}
        onRemoveRole={vi.fn()}
        onRoleDialogClosed={vi.fn()}
      />,
    );
    expect(await screen.findByText("Add role dialog for Jane Doe")).toBeInTheDocument();
  });

  it("clears the add-role member and notifies the caller when the dialog closes", async () => {
    const onAddRoleMemberChange = vi.fn();
    const onRoleDialogClosed = vi.fn();
    render(
      <TeamMemberManagementSheets
        teamId="team-1"
        teamName="Under 10s"
        clubId="club-1"
        currentUserId="user-2"
        selectedMember={null}
        onSelectedMemberChange={vi.fn()}
        addRoleMember={{ userId: "user-1", userName: "Jane Doe", existingRoles: ["coach"] }}
        onAddRoleMemberChange={onAddRoleMemberChange}
        onRemoveMember={vi.fn()}
        onRemoveRole={vi.fn()}
        onRoleDialogClosed={onRoleDialogClosed}
      />,
    );
    fireEvent.click(await screen.findByText("Close add role dialog"));
    expect(onAddRoleMemberChange).toHaveBeenCalledWith(null);
    expect(onRoleDialogClosed).toHaveBeenCalledTimes(1);
  });
});
