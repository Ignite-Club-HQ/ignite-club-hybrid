import { describe, expect, it } from "vitest";
import { buildEventRsvpBuckets } from "./eventRsvpBuckets";

const sharedOptions = {
  effectiveShowAll: false,
  isMiniLeagueEvent: false,
  adultsAreTheAudience: false,
  playerUserIds: new Set(["player-1"]),
  isTargetedScope: false,
  scopedChildIds: new Set<string>(),
  scopedAdultIds: new Set<string>(),
  scopedChildNames: new Map<string, string>(),
};

describe("buildEventRsvpBuckets", () => {
  it("keeps the default audience to players and children while deduplicating linked child rows", () => {
    const result = buildEventRsvpBuckets({
      ...sharedOptions,
      rsvps: [
        { status: "going", user_id: "adult-1" },
        { status: "going", user_id: "player-1" },
        { status: "going", user_id: "parent-1", child_id: "child-1" },
        {
          status: "going",
          user_id: "parent-2",
          mini_league_player_id: "mini-league-player-1",
          mini_league_players: { child_id: "child-1" },
        },
      ],
    });

    expect(result.goingRsvps.map((rsvp) => rsvp.user_id)).toEqual(["player-1", "parent-1"]);
  });

  it("retains scoped parents and hydrates their child's missing name", () => {
    const result = buildEventRsvpBuckets({
      ...sharedOptions,
      effectiveShowAll: true,
      isTargetedScope: true,
      scopedChildIds: new Set(["child-1"]),
      scopedAdultIds: new Set(["parent-1"]),
      scopedChildNames: new Map([["child-1", "Sam Player"]]),
      rsvps: [
        { status: "maybe", user_id: "parent-1", child_id: "child-1" },
        { status: "maybe", user_id: "outsider", child_id: "child-2" },
        { status: "maybe", user_id: "outsider" },
      ],
    });

    expect(result.maybeRsvps).toEqual([
      {
        status: "maybe",
        user_id: "parent-1",
        child_id: "child-1",
        children: { name: "Sam Player" },
      },
    ]);
  });

  it("shows adult self-RSVPs for parents-only events", () => {
    const result = buildEventRsvpBuckets({
      ...sharedOptions,
      adultsAreTheAudience: true,
      rsvps: [{ status: "not_going", user_id: "parent-1" }],
    });

    expect(result.notGoingRsvps).toHaveLength(1);
  });
});
