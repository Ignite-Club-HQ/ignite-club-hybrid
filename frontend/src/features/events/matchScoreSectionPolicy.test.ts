import { describe, expect, it } from "vitest";
import { deriveMatchOpponent, resolveMatchScoreSection } from "./matchScoreSectionPolicy";

describe("match score section policy", () => {
  it.each([
    ["Round 4: Riverside v Wolves", "Wolves"],
    ["Riverside vs. Stirling District", "Stirling District"],
    ["Riverside versus Eagles", "Eagles"],
    ["Training", null],
  ])("derives an opponent from %s", (title, expected) => {
    expect(deriveMatchOpponent(null, title)).toBe(expected);
  });
  it("prefers the explicit opponent over title inference", () => {
    expect(deriveMatchOpponent("Falcons", "Riverside v Wolves")).toBe("Falcons");
  });
  it.each([
    ["game", "team-1", true, false, true],
    ["game", "team-1", false, true, true],
    ["game", "team-1", false, false, false],
    ["game", null, true, true, false],
    ["social", "team-1", true, true, false],
  ] as const)("resolves visibility for %s / %s / member=%s / manager=%s", (eventType, teamId, isTeamMember, canManageEvent, visible) => {
    expect(resolveMatchScoreSection({
      eventType, teamId, isTeamMember, canManageEvent, canOperateMatch: false,
    }).visible).toBe(visible);
  });
  it("keeps score operation permission independent from visibility permission", () => {
    expect(resolveMatchScoreSection({
      eventType: "game", teamId: "team-1", isTeamMember: true,
      canManageEvent: false, canOperateMatch: false,
    })).toMatchObject({ visible: true, canEdit: false });
  });
});
