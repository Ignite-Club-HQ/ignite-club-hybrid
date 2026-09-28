import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEAM_RSVP_AUDIENCE,
  isParentFirstEvent,
  resolveRsvpAudience,
  shouldPromptParent,
  shouldPromptPlayer,
} from "./rsvpAudience";

describe("RSVP audience rules", () => {
  it("prefers a valid event override over the team default", () => {
    expect(resolveRsvpAudience("players_only", "parents_only")).toBe("players_only");
  });

  it("falls back from an invalid event override to a valid team default", () => {
    expect(resolveRsvpAudience("unexpected", "parents_only")).toBe("parents_only");
  });

  it("uses the safe global default when neither stored value is valid", () => {
    expect(resolveRsvpAudience(null, "unexpected")).toBe(DEFAULT_TEAM_RSVP_AUDIENCE);
  });

  it.each([
    ["players_only", true, false],
    ["players_and_parents", true, true],
    ["parents_only", false, true],
  ] as const)("maps %s to the correct player and parent prompts", (audience, player, parent) => {
    expect(shouldPromptPlayer(audience)).toBe(player);
    expect(shouldPromptParent(audience)).toBe(parent);
  });

  it("treats only club-wide social events as parent-first", () => {
    expect(isParentFirstEvent({ team_id: null, type: "social" })).toBe(true);
    expect(isParentFirstEvent({ team_id: "team-1", type: "social" })).toBe(false);
    expect(isParentFirstEvent({ team_id: null, type: "training" })).toBe(false);
    expect(isParentFirstEvent(null)).toBe(false);
  });
});
