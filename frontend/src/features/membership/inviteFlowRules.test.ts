import { describe, expect, it } from "vitest";
import { allowedInviteRole, needsInviteChildEntry } from "./inviteFlowRules";
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
});