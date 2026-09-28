import { describe, expect, it } from "vitest";
import { membershipKeys } from "./membershipQueryKeys";

describe("membershipKeys", () => {
  it("preserves invite token identities", () => {
    expect(membershipKeys.pendingInviteToken("token-1")).toEqual([
      "pending-invite-token", "token-1",
    ]);
    expect(membershipKeys.teamInvite("token-1")).toEqual(["team-invite", "token-1"]);
  });

  it("preserves user and destination invite identities", () => {
    expect(membershipKeys.pendingInvitesForUser("user-1")).toEqual([
      "pending-invites-for-user", "user-1",
    ]);
    expect(membershipKeys.inviteRoles("team-1", "club-1", "user-1")).toEqual([
      "user-invite-roles", "team-1", "club-1", "user-1",
    ]);
    expect(membershipKeys.joinProfile("user-1")).toEqual([
      "user-profile-for-join", "user-1",
    ]);
    expect(membershipKeys.teamChildrenForLinking("team-1")).toEqual([
      "team-children-for-linking", "team-1",
    ]);
  });

  it("retains intentional prefixes for post-accept refresh", () => {
    expect(membershipKeys.userRoles()).toEqual(["user-roles"]);
    expect(membershipKeys.pendingInvites()).toEqual(["pending-invites-for-user"]);
  });

  it("preserves exact team administration identities", () => {
    expect(membershipKeys.teamRoles("team-1")).toEqual(["team-roles", "team-1"]);
    expect(membershipKeys.teamRoles()).toEqual(["team-roles"]);
    expect(membershipKeys.teamChildren("team-1")).toEqual(["team-children", "team-1"]);
    expect(membershipKeys.teamChildren()).toEqual(["team-children"]);
    expect(membershipKeys.teamChatMembers("team-1")).toEqual([
      "chat-members", "team", "team-1",
    ]);
    expect(membershipKeys.authorizedScopes()).toEqual(["authorized-scopes"]);
  });
});
