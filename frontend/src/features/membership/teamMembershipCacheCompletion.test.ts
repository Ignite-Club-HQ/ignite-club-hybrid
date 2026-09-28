import { describe, expect, it, vi } from "vitest";
import {
  refreshAfterLeavingTeam,
  refreshChatManagedTeamMembership,
  refreshChatRemovedTeamMember,
  refreshRemovedTeamChild,
  refreshRemovedTeamMember,
  refreshTeamRoleChange,
} from "./teamMembershipCacheCompletion";

const client = () => ({ invalidateQueries: vi.fn() });

describe("team membership cache completion", () => {
  it("refreshes only the exact roster after one role changes", () => {
    const queryClient = client();
    refreshTeamRoleChange(queryClient, "team-1");
    expect(queryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["team-roles", "team-1"] }],
    ]);
  });

  it("refreshes roster, chat authorization and scopes after full member removal", () => {
    const queryClient = client();
    refreshRemovedTeamMember(queryClient, "team-1");
    expect(queryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["team-roles", "team-1"] }],
      [{ queryKey: ["chat-members", "team", "team-1"] }],
      [{ queryKey: ["authorized-scopes"] }],
    ]);
  });

  it("refreshes only the exact child roster after child assignment removal", () => {
    const queryClient = client();
    refreshRemovedTeamChild(queryClient, "team-1");
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["team-children", "team-1"],
    });
  });

  it("preserves chat-context refresh after a chat-managed team role change", () => {
    const queryClient = client();
    refreshChatManagedTeamMembership(queryClient, "team-1", "group", "chat-1");
    expect(queryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["team-roles", "team-1"] }],
      [{ queryKey: ["chat-members", "group", "chat-1"] }],
    ]);
  });

  it("also refreshes authorization after atomic chat member removal", () => {
    const queryClient = client();
    refreshChatRemovedTeamMember(queryClient, "team-1", "team", "team-1");
    expect(queryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["team-roles", "team-1"] }],
      [{ queryKey: ["chat-members", "team", "team-1"] }],
      [{ queryKey: ["authorized-scopes"] }],
    ]);
  });

  it("preserves every existing membership/event surface after self-leave", () => {
    const queryClient = client();
    refreshAfterLeavingTeam(queryClient, "team-1");
    expect(queryClient.invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual([
      ["team-roles", "team-1"],
      ["user-roles"],
      ["user-memberships-for-events"],
      ["user-memberships-and-events"],
      ["user-clubs-for-filter"],
      ["user-teams-for-filter"],
      ["events"],
      ["user-rsvps-home"],
    ]);
  });
});
