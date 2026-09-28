import { describe, expect, it } from "vitest";
import { buildSharedEventPayload, type SharedEventPayloadInput } from "@/features/events/eventPayloadPolicy";

const base = (overrides: Partial<SharedEventPayloadInput> = {}): SharedEventPayloadInput => ({
  title: "  Match Night  ", type: "game", address: "  Main Oval  ",
  description: "  Bring boots  ", clubId: "club-1", teamId: "team-1",
  price: "", opponent: "  Wolves  ", isBye: false, arrivalMinutesBefore: "30",
  rsvpAudience: "players_and_parents", allowGuests: false, maxGuestsPerMember: 2,
  restrictedRoles: [], adultsOnly: false, rsvpGrouping: "", targetTeamIds: null,
  ...overrides,
});

describe("shared event payload policy", () => {
  it("normalizes the shared team-game payload", () => {
    expect(buildSharedEventPayload(base())).toEqual({
      title: "Match Night", type: "game", address: "Main Oval",
      description: "Bring boots", amount: null, club_id: "club-1", team_id: "team-1",
      opponent: "Wolves", arrival_minutes_before: 30,
      rsvp_audience: "players_and_parents", is_bye: false,
      allow_guests: null, max_guests_per_member: null, restricted_to_roles: null,
      adults_only: false, rsvp_grouping: null, target_team_ids: null,
    });
  });

  it("clears opponent and arrival details for a bye", () => {
    expect(buildSharedEventPayload(base({ isBye: true }))).toEqual(expect.objectContaining({
      is_bye: true, opponent: null, arrival_minutes_before: null,
    }));
  });

  it("clears game-only fields when the type changes", () => {
    expect(buildSharedEventPayload(base({ type: "training", isBye: true }))).toEqual(expect.objectContaining({
      is_bye: false, opponent: null, arrival_minutes_before: null,
    }));
  });

  it("keeps payment, guests and restricted roles only for a club-wide social", () => {
    expect(buildSharedEventPayload(base({
      type: "social", teamId: "", price: "12.50", allowGuests: true,
      maxGuestsPerMember: 3, restrictedRoles: ["coach", "parent"],
    }))).toEqual(expect.objectContaining({
      amount: 12.5, allow_guests: true, max_guests_per_member: 3,
      restricted_to_roles: ["coach", "parent"],
    }));
  });

  it("clears social-only data for team social and non-social events", () => {
    expect(buildSharedEventPayload(base({
      type: "social", teamId: "team-1", price: "8", allowGuests: true,
      restrictedRoles: ["parent"],
    }))).toEqual(expect.objectContaining({ amount: 8, restricted_to_roles: null }));
    expect(buildSharedEventPayload(base({
      type: "game", price: "8", allowGuests: true, restrictedRoles: ["parent"],
    }))).toEqual(expect.objectContaining({
      amount: null, allow_guests: null, max_guests_per_member: null, restricted_to_roles: null,
    }));
  });

  it("keeps grouping and multi-team targets only for club-wide game/social events", () => {
    const targets = ["team-1", "team-2"];
    expect(buildSharedEventPayload(base({ teamId: "", rsvpGrouping: "team", targetTeamIds: targets })))
      .toEqual(expect.objectContaining({ rsvp_grouping: "team", target_team_ids: targets }));
    expect(buildSharedEventPayload(base({ teamId: "team-1", rsvpGrouping: "team", targetTeamIds: targets })))
      .toEqual(expect.objectContaining({ rsvp_grouping: null, target_team_ids: null }));
    expect(buildSharedEventPayload(base({ type: "training", teamId: "", rsvpGrouping: "team", targetTeamIds: targets })))
      .toEqual(expect.objectContaining({ rsvp_grouping: null, target_team_ids: null }));
  });

  it("requires at least two teams for subset targeting", () => {
    expect(buildSharedEventPayload(base({ teamId: "", targetTeamIds: ["team-1"] })).target_team_ids)
      .toBeNull();
  });
});
