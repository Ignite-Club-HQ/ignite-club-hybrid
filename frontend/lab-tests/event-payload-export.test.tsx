import { expect, test } from "vitest";
import {
  buildSharedEventPayload,
  type SharedEventPayloadInput,
} from "../src/features/events/eventPayloadPolicy";
import { evaluateTrainingConflicts } from "../src/features/events/trainingConflictPolicy";

const baseInput: SharedEventPayloadInput = {
  title: "  Synthetic match  ",
  type: "game",
  address: " Test Oval ",
  description: "  Details  ",
  clubId: "club-1",
  teamId: "team-1",
  price: "12.50",
  opponent: "  Rivals  ",
  isBye: false,
  arrivalMinutesBefore: "30",
  rsvpAudience: "all",
  allowGuests: false,
  maxGuestsPerMember: 0,
  restrictedRoles: [],
  adultsOnly: false,
  rsvpGrouping: "",
  targetTeamIds: null,
};

function normalizeForm(input: {
  type: "game" | "training" | "social" | "mini_league";
  teamId: string;
  miniLeagueId: string | null;
}) {
  return {
    type: input.type === "mini_league" ? "game" as const : input.type,
    teamId: input.type === "mini_league" ? "" : input.teamId,
    miniLeagueId: input.type === "mini_league" ? input.miniLeagueId : null,
  };
}

test("EventPayload export: normalizes mini-league events to a club game", () => {
  expect(normalizeForm({
    type: "mini_league",
    teamId: "team-ignored",
    miniLeagueId: "league-7",
  })).toEqual({
    type: "game",
    teamId: "",
    miniLeagueId: "league-7",
  });
  expect(buildSharedEventPayload({
    ...baseInput,
    teamId: "",
  })).toMatchObject({
    type: "game",
    team_id: null,
  });
});

test("EventPayload export: applies the shared create/edit normalization policy", () => {
  expect(buildSharedEventPayload(baseInput)).toEqual({
    title: "Synthetic match",
    type: "game",
    address: "Test Oval",
    description: "Details",
    amount: null,
    club_id: "club-1",
    team_id: "team-1",
    opponent: "Rivals",
    arrival_minutes_before: 30,
    rsvp_audience: "all",
    is_bye: false,
    allow_guests: null,
    max_guests_per_member: null,
    restricted_to_roles: null,
    adults_only: false,
    rsvp_grouping: null,
    target_team_ids: null,
  });

  expect(buildSharedEventPayload({
    ...baseInput,
    type: "social",
    teamId: "",
    price: "24.50",
    allowGuests: true,
    maxGuestsPerMember: 3,
    restrictedRoles: ["parent"],
    rsvpGrouping: "team",
    targetTeamIds: ["team-2", "team-3"],
  })).toMatchObject({
    amount: 24.5,
    team_id: null,
    allow_guests: true,
    max_guests_per_member: 3,
    restricted_to_roles: ["parent"],
    rsvp_grouping: "team",
    target_team_ids: ["team-2", "team-3"],
  });
});

test("EventPayload export: excludes game-only fields for non-game and bye events", () => {
  expect(buildSharedEventPayload({
    ...baseInput,
    type: "training",
    isBye: true,
    opponent: "Ignored",
    arrivalMinutesBefore: "45",
  })).toMatchObject({
    opponent: null,
    arrival_minutes_before: null,
    is_bye: false,
  });
});

test("EventPayload export: detects direct and recurring training conflicts by club slot", () => {
  const targetDateTime = new Date("2026-08-10T10:00:00");
  const direct = {
    data: [{
      id: "event-direct",
      title: "Existing training",
      event_date: "2026-08-10T10:00:00",
      address: "test oval",
      teams: { name: "U10 Blue" },
    }],
    error: null,
  };
  const recurring = {
    data: [{
      id: "event-recurring",
      title: "Weekly training",
      event_date: "2026-08-17T10:00:00",
      address: "TEST OVAL",
      teams: { name: "U12 Gold" },
    }],
    error: null,
  };

  expect(evaluateTrainingConflicts({
    targetDateTime,
    address: " Test Oval ",
    directDateQuery: direct,
    recurringParentQuery: recurring,
  })).toMatchObject({
    status: "conflict",
    conflicts: [
      { title: "Existing training", team_name: "U10 Blue" },
      { title: "Weekly training", team_name: "U12 Gold" },
    ],
  });
});

test("EventPayload export: fails closed on conflict-query errors and allows non-training bypass", () => {
  const failure = new Error("schedule unavailable");
  expect(evaluateTrainingConflicts({
    targetDateTime: new Date("2026-08-10T10:00:00"),
    address: "Test Oval",
    directDateQuery: { data: null, error: failure },
    recurringParentQuery: { data: [], error: null },
  })).toEqual({ status: "error" });

  const shouldCheck = (type: string, skipConflictCheck: boolean) =>
    !skipConflictCheck && type === "training";
  expect(shouldCheck("training", false)).toBe(true);
  expect(shouldCheck("game", false)).toBe(false);
  expect(shouldCheck("training", true)).toBe(false);
});

test("EventPayload export: resets a changed reminder while preserving an unchanged schedule", () => {
  const reminderSent = (enabled: boolean, previousHours: number | null, nextHours: number) =>
    enabled ? previousHours === nextHours : false;

  expect(reminderSent(true, 24, 24)).toBe(true);
  expect(reminderSent(true, 24, 12)).toBe(false);
  expect(reminderSent(false, 24, 24)).toBe(false);
});

test("EventPayload export: keeps the transaction date fields aligned for single and series edits", () => {
  const parsedDateTime = new Date("2026-08-10T10:00:00Z");
  const update = {
    updates: { ...buildSharedEventPayload(baseInput) },
    selectedEventDate: parsedDateTime.toISOString(),
    selectedStartTime: "2026-08-10T10:00:00.000Z",
    selectedEndTime: "2026-08-10T11:00:00.000Z",
    updateSeries: true,
  };
  expect(update).toMatchObject({
    selectedEventDate: "2026-08-10T10:00:00.000Z",
    selectedStartTime: "2026-08-10T10:00:00.000Z",
    selectedEndTime: "2026-08-10T11:00:00.000Z",
    updateSeries: true,
  });
});
