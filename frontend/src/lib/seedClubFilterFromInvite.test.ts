import { describe, it, expect, beforeEach, vi } from "vitest";
import { seedClubFilterFromInvite } from "./seedClubFilterFromInvite";

describe("seedClubFilterFromInvite", () => {
  beforeEach(() => localStorage.clear());

  it("does nothing without both user and invited club identity", () => {
    const setTheme = vi.fn();
    expect(seedClubFilterFromInvite(null, "club-1", setTheme)).toBe(false);
    expect(seedClubFilterFromInvite("user-1", null, setTheme)).toBe(false);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("seeds the invited club when the user has no existing preference", () => {
    const setTheme = vi.fn();
    expect(seedClubFilterFromInvite("user-1", "club-invited", setTheme)).toBe(true);
    expect(setTheme).toHaveBeenCalledWith("club-invited");
  });

  it("never overwrites an explicit club choice", () => {
    localStorage.setItem("ignite-club-theme-user-1", "club-existing");
    const setTheme = vi.fn();
    expect(seedClubFilterFromInvite("user-1", "club-invited", setTheme)).toBe(false);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("replaces the automatic no-club sentinel by default", () => {
    localStorage.setItem("ignite-club-theme-user-1", "__ignite_no_club__");
    const setTheme = vi.fn();
    expect(seedClubFilterFromInvite("user-1", "club-invited", setTheme)).toBe(true);
    expect(setTheme).toHaveBeenCalledWith("club-invited");
  });

  it("respects an instruction not to replace the no-club sentinel", () => {
    localStorage.setItem("ignite-club-theme-user-1", "__ignite_no_club__");
    const setTheme = vi.fn();
    expect(seedClubFilterFromInvite("user-1", "club-invited", setTheme, { overrideSentinel: false })).toBe(false);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("fails safely if applying the theme throws", () => {
    expect(seedClubFilterFromInvite("user-1", "club-invited", () => { throw new Error("storage failed"); })).toBe(false);
  });
});
