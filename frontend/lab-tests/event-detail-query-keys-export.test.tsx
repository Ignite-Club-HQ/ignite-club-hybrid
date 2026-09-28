import { expect, test, vi } from "vitest";
import { completeEventRsvp } from "../src/features/events/eventRsvpCompletion";
import { refreshEventDuties } from "../src/features/events/eventDutyCacheCompletion";
import { refreshEventPayments } from "../src/features/events/eventPaymentCacheCompletion";
import { hasEventManagerRole } from "../src/features/events/eventManagerPolicy";
import { resolveEventCapabilities } from "../src/features/events/eventCapabilities";
import { getEventEligibleTeamIds, eventTargetTeamKey } from "../src/lab/eventAudience";
import { eventKeys } from "../src/lab/eventQueryKeys";
import { refreshEventCaches } from "../src/lab/eventCacheRefresh";

function queryClient() {
  return { invalidateQueries: vi.fn() };
}

test("EventDetailPage query-key export: core reads use canonical identities", () => {
  expect(eventKeys.detail("event-1")).toEqual(["event", "event-1"]);
  expect(eventKeys.rsvps("event-1")).toEqual(["event-rsvps", "event-1"]);
  expect(eventKeys.duties("event-1")).toEqual(["event-duties", "event-1"]);
  expect(eventKeys.payments("event-1")).toEqual(["event-payments", "event-1"]);
  expect(eventKeys.recentReminders("event-1")).toEqual(["event-recent-reminders", "event-1"]);
  expect(eventKeys.goingRsvps("event-1")).toEqual(["event-rsvps-going", "event-1"]);
  expect(eventKeys.groups("event-1")).toEqual(["event-groups", "event-1"]);
});

test("EventDetailPage query-key export: RSVP, duty, payment, and list refreshes share the family", () => {
  const client = queryClient();
  completeEventRsvp(client, {
    eventId: "event-1",
    teamId: "team-1",
    includeGroups: true,
    includePitch: true,
  });
  refreshEventDuties(client, "event-1");
  refreshEventPayments(client, "event-1");
  refreshEventCaches(client as never, "user-1");

  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.rsvps("event-1") });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.goingRsvps("event-1") });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.groups("event-1") });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.pitchTeamMembers("team-1", "event-1") });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.duties("event-1") });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.payments("event-1") });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.lists() });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.upcoming() });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.teamNext() });
  expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: eventKeys.home("user-1") });
});

test("EventDetailPage query-key export: target-team identities are stable and scoped", () => {
  const targeted = {
    team_id: null,
    target_team_ids: ["team-3", "team-2"],
    mini_league_id: null,
  };
  expect(getEventEligibleTeamIds(targeted)).toEqual(["team-3", "team-2"]);
  expect(eventTargetTeamKey(targeted)).toBe("team-2,team-3");
  expect(getEventEligibleTeamIds({ ...targeted, team_id: "team-1" })).toEqual(["team-1"]);
  expect(getEventEligibleTeamIds({ team_id: null, target_team_ids: [], mini_league_id: null })).toBeNull();
});

test("EventDetailPage query-key export: manager roles and app-admin override gate capabilities", () => {
  expect(hasEventManagerRole("club", [{ role: "committee_member" }])).toBe(true);
  expect(hasEventManagerRole("team", [{ role: "coach" }])).toBe(true);
  expect(hasEventManagerRole("miniLeague", [{ role: "player" }])).toBe(false);
  expect(resolveEventCapabilities({
    isEventManager: false,
    isAppAdmin: false,
    isSubsManagerForEvent: false,
  })).toEqual({ canManageEvent: false, canOperateMatch: false });
  expect(resolveEventCapabilities({
    isEventManager: false,
    isAppAdmin: true,
    isSubsManagerForEvent: false,
  })).toEqual({ canManageEvent: true, canOperateMatch: true });
});
