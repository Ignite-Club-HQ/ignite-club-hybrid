import { describe, expect, it } from "vitest";
import { roleLabels } from "./rolePresentation";

describe("role presentation labels", () => {
  it("keeps shared member and admin vocabulary stable", () => {
    expect(roleLabels).toMatchObject({
      basic_user: "Member",
      club_admin: "Club Admin",
      team_admin: "Team Admin",
      coach: "Coach",
      player: "Player",
      parent: "Parent",
      app_admin: "App Admin",
    });
  });
});
