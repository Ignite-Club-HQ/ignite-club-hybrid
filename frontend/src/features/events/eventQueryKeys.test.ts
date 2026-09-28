import { describe, expect, it } from "vitest";
import { eventKeys } from "./eventQueryKeys";

describe("eventKeys", () => {
  it("preserves list and Home cache prefixes", () => {
    expect(eventKeys.lists()).toEqual(["events"]);
    expect(eventKeys.upcoming()).toEqual(["upcoming-events"]);
    expect(eventKeys.teamNext()).toEqual(["team-next-event"]);
    expect(eventKeys.home("user-1")).toEqual(["user-memberships-and-events", "user-1"]);
  });

  it("preserves exact event-detail derived keys", () => {
    expect(eventKeys.detail("event-1")).toEqual(["event", "event-1"]);
    expect(eventKeys.rsvps("event-1")).toEqual(["event-rsvps", "event-1"]);
    expect(eventKeys.goingRsvps("event-1")).toEqual(["event-rsvps-going", "event-1"]);
    expect(eventKeys.groups("event-1")).toEqual(["event-groups", "event-1"]);
    expect(eventKeys.duties("event-1")).toEqual(["event-duties", "event-1"]);
    expect(eventKeys.payments("event-1")).toEqual(["event-payments", "event-1"]);
    expect(eventKeys.recentReminders("event-1")).toEqual(["event-recent-reminders", "event-1"]);
  });

  it("preserves PitchBoard event cache keys and broad team-member prefix", () => {
    expect(eventKeys.pitchLinked("event-1")).toEqual(["pitch-linked-event", "event-1"]);
    expect(eventKeys.pitchGoingRsvps("event-1")).toEqual([
      "pitch-board-going-rsvps",
      "event-1",
    ]);
    expect(eventKeys.pitchTeamMembers()).toEqual(["team-members-for-pitch"]);
    expect(eventKeys.pitchTeamMembers("team-1", "event-1")).toEqual([
      "team-members-for-pitch",
      "team-1",
      "event-1",
    ]);
  });
});
