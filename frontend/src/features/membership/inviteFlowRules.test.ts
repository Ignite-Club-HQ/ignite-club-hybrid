import { describe, expect, it } from "vitest";
import { allowedInviteRole, canManageTeamInviteLinks, needsInviteChildEntry } from "./inviteFlowRules";
describe("invitation completion rules", () => {
  it("parent acceptance requests child entry unless a child was supplied or completed", () => {
    expect(needsInviteChildEntry(["parent"], false, 0)).toBe(true);
    expect(needsInviteChildEntry(["parent"], true, 0)).toBe(false);
    expect(needsInviteChildEntry(["parent"], false, 1)).toBe(false);
    expect(needsInviteChildEntry(["player"], false, 0)).toBe(false);
  });
  it("never chooses a role outside the allowed options", () => {
    expect(allowedInviteRole("player", ["parent"])).toBe("parent");
    expect(allowedInviteRole("player", [])).toBeUndefined();
  });
  it("allows resolved team and club managers to manage invite links", () => {
    expect(canManageTeamInviteLinks(true, false)).toBe(true);
  });
  it("does not grant link management to player-only inviters", () => {
    expect(canManageTeamInviteLinks(true, true)).toBe(false);
    expect(canManageTeamInviteLinks(false, true)).toBe(false);
  });
  it("does not grant link management without manager access", () => {
    expect(canManageTeamInviteLinks(false, false)).toBe(false);
  });
});