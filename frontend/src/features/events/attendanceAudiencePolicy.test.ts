import { describe, expect, it } from "vitest";
import {
  attendanceRsvpKey,
  calculateAttendanceNonResponders,
  prepareAttendanceRsvps,
  shouldDisplayAttendanceRsvp,
} from "@/features/events/attendanceAudiencePolicy";

describe("attendance audience and identity policy", () => {
  it("shows only players and child identities until all roles are requested", () => {
    const playerIds = new Set(["player-1"]);
    const options = { showAll: false, miniLeague: false, playerUserIds: playerIds };
    expect(shouldDisplayAttendanceRsvp({ user_id: "player-1" }, options)).toBe(true);
    expect(shouldDisplayAttendanceRsvp({ user_id: "parent-1" }, options)).toBe(false);
    expect(shouldDisplayAttendanceRsvp({ child_id: "child-1" }, options)).toBe(true);
    expect(shouldDisplayAttendanceRsvp({ mini_league_player_id: "mlp-1" }, options)).toBe(true);
    expect(shouldDisplayAttendanceRsvp({ user_id: "parent-1" }, { ...options, showAll: true })).toBe(true);
  });

  it("hides adult self-RSVPs in the default mini-league player view", () => {
    const options = { showAll: false, miniLeague: true, playerUserIds: new Set<string>() };
    expect(shouldDisplayAttendanceRsvp({ user_id: "parent-1" }, options)).toBe(false);
    expect(shouldDisplayAttendanceRsvp({ mini_league_player_id: "mlp-1" }, options)).toBe(true);
  });

  it("deduplicates direct and mini-league RSVPs for the same linked child", () => {
    const direct = { id: "direct", child_id: "child-1" };
    const linked = { id: "league", mini_league_player_id: "mlp-1", mini_league_players: { child_id: "child-1" } };
    expect(attendanceRsvpKey(direct)).toBe("c:child-1");
    expect(attendanceRsvpKey(linked)).toBe("c:child-1");
    expect(prepareAttendanceRsvps([direct, linked], {
      targeted: false, scopedChildIds: new Set(), scopedAdultIds: new Set(), scopedChildNames: new Map(),
    })).toEqual([direct]);
  });

  it("filters targeted outsiders and hydrates an authorized child name", () => {
    const rows = [
      { id: "child", child_id: "child-1", children: null },
      { id: "outsider-child", child_id: "child-2" },
      { id: "adult", user_id: "adult-1" },
      { id: "outsider-adult", user_id: "adult-2" },
    ];
    expect(prepareAttendanceRsvps(rows, {
      targeted: true,
      scopedChildIds: new Set(["child-1"]),
      scopedAdultIds: new Set(["adult-1"]),
      scopedChildNames: new Map([["child-1", "Sam"]]),
    })).toEqual([
      { id: "child", child_id: "child-1", children: { name: "Sam" } },
      { id: "adult", user_id: "adult-1" },
    ]);
  });

  it("does not treat a parent's personal RSVP as the child's response", () => {
    const result = calculateAttendanceNonResponders({
      rsvps: [{ user_id: "parent-1", child_id: null, status: "going" }],
      miniLeague: true,
      showAll: false,
      miniLeaguePlayers: [{ id: "mlp-1", child_id: "child-1", parent_user_id: "parent-1" }],
    });
    expect(result.children.map((child) => child.id)).toEqual(["mlp-1"]);
  });

  it("recognizes either player-specific or linked-child mini-league responses", () => {
    const players = [
      { id: "mlp-1", child_id: "child-1" },
      { id: "mlp-2", child_id: "child-2" },
      { id: "mlp-3", child_id: null },
    ];
    const result = calculateAttendanceNonResponders({
      rsvps: [
        { mini_league_player_id: "mlp-1", user_id: "parent-1" },
        { child_id: "child-2", user_id: "parent-2" },
      ],
      miniLeague: true, showAll: false, miniLeaguePlayers: players,
    });
    expect(result.children.map((child) => child.id)).toEqual(["mlp-3"]);
  });

  it("a child response removes every linked parent and guardian from no-response", () => {
    const result = calculateAttendanceNonResponders({
      rsvps: [{ child_id: "child-1", user_id: "parent-1" }],
      miniLeague: false,
      showAll: true,
      visibleMembers: [{ id: "parent-1" }, { id: "guardian-1" }, { id: "player-2" }],
      reminderMembers: [{ id: "parent-1" }, { id: "guardian-1" }, { id: "player-2" }],
      children: [{ id: "child-1", parent_id: "parent-1" }, { id: "child-2", parent_id: "parent-2" }],
      childGuardians: [{ child_id: "child-1", guardian_id: "guardian-1" }],
    });
    expect(result.adults.map((adult) => adult.id)).toEqual(["player-2"]);
    expect(result.children.map((child) => child.id)).toEqual(["child-2"]);
    expect(result.reminderAdults.map((adult) => adult.id)).toEqual(["player-2"]);
  });

  it("visible filtering never narrows the independent reminder audience", () => {
    const result = calculateAttendanceNonResponders({
      rsvps: [], miniLeague: false, showAll: false,
      visibleMembers: [{ id: "player-1" }],
      reminderMembers: [{ id: "player-1" }, { id: "parent-1" }],
      children: [], childGuardians: [],
    });
    expect(result.adults.map((adult) => adult.id)).toEqual(["player-1"]);
    expect(result.reminderAdults.map((adult) => adult.id)).toEqual(["player-1", "parent-1"]);
  });
});
