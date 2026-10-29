import { describe, expect, it } from "vitest";
import { normalizeOfficialRole, officialJoinPath } from "./officialRole";

describe("production official invitation compatibility", () => {
  it("maps production committee links to the existing committee member role", () => {
    expect(normalizeOfficialRole("committee")).toBe("committee_member");
  });
  it("preserves ICP committee and referee roles", () => {
    expect(normalizeOfficialRole("committee_member")).toBe("committee_member");
    expect(normalizeOfficialRole("referee")).toBe("referee");
  });
  it("does not accept organizer or arbitrary roles as an official invitation", () => {
    expect(normalizeOfficialRole("competition_admin")).toBeNull();
    expect(normalizeOfficialRole("player")).toBeNull();
    expect(normalizeOfficialRole(undefined)).toBeNull();
  });
  it("retains email verification mode across the sign-in redirect", () => {
    expect(officialJoinPath("test token", true)).toBe("/competitions/officials/join?email=1&token=test%20token");
    expect(officialJoinPath("test token", false)).toBe("/competitions/officials/join?token=test%20token");
  });
});