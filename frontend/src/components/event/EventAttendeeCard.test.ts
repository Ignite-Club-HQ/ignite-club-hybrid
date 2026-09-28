import { describe, expect, it } from "vitest";
import { resolveEventAttendeeRoleLabel } from "./EventAttendeeCard";

describe("resolveEventAttendeeRoleLabel", () => {
  it("uses roles scoped to the event team before other memberships", () => {
    expect(resolveEventAttendeeRoleLabel({
      role_team_pairs: [
        { role: "club_admin", team_id: "other-team" },
        { role: "player", team_id: "event-team" },
      ],
    }, { team_id: "event-team" })).toBe("player");
  });

  it("falls back to club roles, then synthetic roles, without leaking another team role", () => {
    expect(resolveEventAttendeeRoleLabel({
      role_team_pairs: [
        { role: "coach", team_id: "other-team" },
        { role: "parent", team_id: null },
      ],
    }, { team_id: "event-team" })).toBe("parent");

    expect(resolveEventAttendeeRoleLabel({
      roles: ["parent", "player"],
    }, { team_id: "event-team" })).toBe("parent");
  });

  it("uses the highest-priority role for a club-wide event", () => {
    expect(resolveEventAttendeeRoleLabel({
      roles: ["player", "team_admin"],
    }, {})).toBe("team_admin");
  });
});
