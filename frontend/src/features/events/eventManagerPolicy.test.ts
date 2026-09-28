import { describe, expect, it } from "vitest";
import {
  EVENT_MANAGER_ROLES,
  hasEventManagerRole,
} from "@/features/events/eventManagerPolicy";

describe("event manager role policy", () => {
  it.each([
    ["club", "club_admin"],
    ["club", "committee_member"],
    ["team", "team_admin"],
    ["team", "coach"],
    ["miniLeague", "league_admin"],
    ["miniLeague", "coach"],
    ["miniLeague", "committee_member"],
  ] as const)("allows %s scope role %s", (scope, role) => {
    expect(hasEventManagerRole(scope, [{ role }])).toBe(true);
  });

  it.each([
    ["club", "player"],
    ["club", "league_admin"],
    ["team", "club_admin"],
    ["team", "parent"],
    ["miniLeague", "team_admin"],
    ["miniLeague", "player"],
  ] as const)("denies unrelated %s scope role %s", (scope, role) => {
    expect(hasEventManagerRole(scope, [{ role }])).toBe(false);
  });

  it("fails closed for missing, empty and malformed role rows", () => {
    expect(hasEventManagerRole("club", undefined)).toBe(false);
    expect(hasEventManagerRole("team", [])).toBe(false);
    expect(hasEventManagerRole("miniLeague", [{ role: null }, {}])).toBe(false);
  });

  it("keeps role lists explicit and free from global app-admin leakage", () => {
    expect(EVENT_MANAGER_ROLES).toEqual({
      club: ["club_admin", "committee_member"],
      team: ["team_admin", "coach"],
      miniLeague: ["league_admin", "coach", "committee_member"],
    });
    expect(Object.values(EVENT_MANAGER_ROLES).flat()).not.toContain("app_admin");
  });
});
