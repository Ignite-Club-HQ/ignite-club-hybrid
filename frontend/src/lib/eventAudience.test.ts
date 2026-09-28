import { describe, it, expect } from "vitest";
import { getEventEligibleTeamIds, eventTargetTeamKey } from "./eventAudience";

describe("getEventEligibleTeamIds", () => {
  it("single-team events return that team", () => {
    expect(getEventEligibleTeamIds({ team_id: "t1" })).toEqual(["t1"]);
  });

  it("multi-team targeted events return the targeted teams", () => {
    expect(getEventEligibleTeamIds({ team_id: null, target_team_ids: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("team_id wins when both are present", () => {
    expect(getEventEligibleTeamIds({ team_id: "t1", target_team_ids: ["a"] })).toEqual(["t1"]);
  });

  it("genuinely club-wide events return null (no team filter)", () => {
    expect(getEventEligibleTeamIds({ team_id: null, target_team_ids: [] })).toBeNull();
    expect(getEventEligibleTeamIds({ team_id: null })).toBeNull();
  });

  it("cache key is order independent", () => {
    expect(eventTargetTeamKey({ target_team_ids: ["b", "a"] })).toBe(
      eventTargetTeamKey({ target_team_ids: ["a", "b"] }),
    );
  });
});
