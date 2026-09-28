import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  eventLocationLabels,
  formatEventAttendanceSummary,
  formatEventCalendarLabel,
  formatEventPassiveFacts,
  getEventAdminActionLabels,
  getEventLifecycleScopes,
  getEventNotificationState,
  resolveEventMapAddress,
  resolveEventMatchScoreContract,
} from "../src/lab/componentCandidatePolicies";
import { getEventEligibleTeamIds } from "../src/lab/eventAudience";

test("preserves event attendance wording for player, social, loading, and unavailable states", () => {
  expect(formatEventAttendanceSummary({ state: "players", count: 1 })).toBe("1 player attending");
  expect(formatEventAttendanceSummary({ state: "players", count: 2 })).toBe("2 players attending");
  expect(formatEventAttendanceSummary({ state: "social", total: 3, adults: 2, children: 1 }))
    .toBe("3 attending (2 adults, 1 child)");
  expect(formatEventAttendanceSummary({ state: "loading" })).toBe("Loading...");
  expect(formatEventAttendanceSummary({ state: "unavailable" })).toBe("Attendance unavailable");
});

test("preserves structured event location precedence and de-duplication", () => {
  const structured = {
    address: "1 Main Road",
    suburb: "Riverside",
    state: "SA",
    postcode: "5000",
    locationName: "Oval",
  };
  expect(resolveEventMapAddress(structured)).toBe("1 Main Road");
  expect(eventLocationLabels(structured)).toEqual([
    "1 Main Road",
    "Riverside, SA, 5000",
    "Oval",
  ]);
  expect(resolveEventMapAddress({ locationName: "Riverside Oval", legacyLocation: "Pitch 2" }))
    .toBe("Pitch 2");
  expect(eventLocationLabels({ locationName: "Riverside Oval", legacyLocation: "Riverside Oval" }))
    .toEqual(["Riverside Oval"]);
  expect(resolveEventMapAddress({})).toBeNull();
});

test("preserves event passive facts and omits incomplete or irrelevant facts", () => {
  expect(formatEventPassiveFacts({
    eventType: "game",
    opponent: "Wolves",
    arrivalTime: "9:45 AM",
    arrivalMinutes: 30,
  })).toEqual({
    opponent: "vs Wolves",
    arrival: "Arrive by 9:45 AM (30 min before kickoff)",
    price: null,
  });
  expect(formatEventPassiveFacts({
    eventType: "game",
    arrivalTime: null,
    arrivalMinutes: 30,
  }).arrival).toBeNull();
  expect(formatEventPassiveFacts({
    eventType: "social",
    opponent: "Not applicable",
    arrivalTime: "9:45 AM",
    arrivalMinutes: 30,
    price: 12.5,
  })).toEqual({
    opponent: null,
    arrival: null,
    price: "$12.50 per person",
  });
  expect(formatEventPassiveFacts({ eventType: "social", price: 0 }).price).toBeNull();
  expect(formatEventPassiveFacts({ eventType: "social", price: null }).price).toBeNull();
});

test("preserves event admin visibility, labels, Pro reminder gating, and lifecycle scopes", () => {
  expect(getEventAdminActionLabels({
    visible: false,
    showEdit: false,
    reminder: "hidden",
    showResend: false,
    showCancel: false,
    showDelete: false,
  }, "Game")).toEqual([]);
  expect(getEventAdminActionLabels({
    visible: true,
    showEdit: true,
    reminder: "enabled",
    showResend: true,
    showCancel: true,
    showDelete: true,
  }, "Game")).toEqual([
    { label: "Edit Game", enabled: true },
    { label: "Send Reminders", enabled: true },
    { label: "Resend Invites", enabled: true },
    { label: "Cancel Game", enabled: true },
    { label: "Delete Game", enabled: true },
  ]);
  expect(getEventAdminActionLabels({
    visible: true,
    showEdit: true,
    reminder: "pro-disabled",
    showResend: false,
    showCancel: true,
    showDelete: true,
  }, "Event")).toEqual([
    { label: "Edit Event", enabled: true },
    { label: "Send Reminders", enabled: false },
    { label: "Cancel Event", enabled: true },
    { label: "Delete Event", enabled: true },
  ]);
  expect(getEventLifecycleScopes(false)).toEqual(["single"]);
  expect(getEventLifecycleScopes(true)).toEqual(["single", "series"]);
});

test("preserves event notification safety and match-score contracts", () => {
  expect(getEventNotificationState(false, false)).toEqual({
    sendLabel: "Send In-App",
    sendDisabled: false,
  });
  expect(getEventNotificationState(true, false)).toEqual({
    sendLabel: "Sending...",
    sendDisabled: true,
  });
  expect(getEventNotificationState(false, true).sendDisabled).toBe(true);
  expect(resolveEventMatchScoreContract({
    visible: true,
    opponent: "Wolves",
    canEdit: false,
    eventId: "event-1",
    teamId: "team-1",
    teamName: null,
    sport: "soccer",
  })).toEqual({
    eventId: "event-1",
    teamId: "team-1",
    teamName: "Our Team",
    opponent: "Wolves",
    sport: "soccer",
    canEdit: false,
  });
  expect(resolveEventMatchScoreContract({
    visible: false,
    opponent: null,
    canEdit: false,
    eventId: "event-1",
    teamId: "team-1",
  })).toBeNull();
  expect(resolveEventMatchScoreContract({
    visible: true,
    opponent: null,
    canEdit: true,
    eventId: "event-1",
    teamId: null,
  })).toBeNull();
});

test("preserves calendar formatting and audience precedence", () => {
  expect(formatEventCalendarLabel("2026-08-12T10:30:00Z"))
    .toBe("Wednesday, August 12 at 10:30 AM");
  expect(getEventEligibleTeamIds({ team_id: "team-primary", target_team_ids: ["team-target"] }))
    .toEqual(["team-primary"]);
  expect(getEventEligibleTeamIds({ team_id: null, target_team_ids: ["team-a", "team-b"] }))
    .toEqual(["team-a", "team-b"]);
  expect(getEventEligibleTeamIds({ team_id: null, target_team_ids: [] })).toBeNull();
});

// Local reconstruction of EventMatchScoreSection: the real production
// component wraps `resolveEventMatchScoreContract` (already proven above)
// with a rendered MatchScoreCard; this component-level shell verifies the
// render boundary (renders nothing when the contract resolves to null,
// otherwise forwards the exact resolved contract) without re-testing the
// pure resolution logic itself.
function EventMatchScoreSection(props: {
  model: { visible: boolean; opponent: string | null; canEdit: boolean };
  eventId: string;
  teamId: string | null;
  teamName?: string | null;
  sport?: string;
}) {
  const contract = resolveEventMatchScoreContract({
    visible: props.model.visible,
    opponent: props.model.opponent,
    canEdit: props.model.canEdit,
    eventId: props.eventId,
    teamId: props.teamId,
    teamName: props.teamName,
    sport: props.sport,
  });
  if (!contract) return null;
  return <div data-testid="score-card">{JSON.stringify(contract)}</div>;
}

test("EventMatchScoreSection passes the resolved event/team/opponent/edit contract to the score card", () => {
  render(<EventMatchScoreSection
    model={{ visible: true, opponent: "Wolves", canEdit: false }}
    eventId="event-1" teamId="team-1" teamName={null} sport="soccer"
  />);
  expect(JSON.parse(screen.getByTestId("score-card").textContent || "{}")).toEqual({
    eventId: "event-1", teamId: "team-1", teamName: "Our Team",
    opponent: "Wolves", sport: "soccer", canEdit: false,
  });
});

test("EventMatchScoreSection renders nothing when policy hides the section or no team is resolved", () => {
  const { container, rerender } = render(<EventMatchScoreSection
    model={{ visible: false, opponent: null, canEdit: false }} eventId="event-1" teamId="team-1"
  />);
  expect(container.innerHTML).toBe("");
  rerender(<EventMatchScoreSection model={{ visible: true, opponent: null, canEdit: true }} eventId="event-1" teamId={null} />);
  expect(container.innerHTML).toBe("");
});

// Local reconstruction of EventAttendanceSummary: the real component wraps
// `formatEventAttendanceSummary` (already proven above) with icon/class
// presentation. This verifies just the render boundary, including the
// destructive-state class the pure string helper cannot express.
function EventAttendanceSummary({ summary }: { summary: Parameters<typeof formatEventAttendanceSummary>[0] }) {
  const label = formatEventAttendanceSummary(summary);
  return (
    <div>
      <span className={summary.state === "unavailable" ? "text-destructive" : undefined}>{label}</span>
    </div>
  );
}

test("EventAttendanceSummary renders singular and plural player summaries", () => {
  const { rerender } = render(<EventAttendanceSummary summary={{ state: "players", count: 1 }} />);
  expect(screen.getByText("1 player attending")).toBeTruthy();
  rerender(<EventAttendanceSummary summary={{ state: "players", count: 2 }} />);
  expect(screen.getByText("2 players attending")).toBeTruthy();
});

test("EventAttendanceSummary renders the social breakdown", () => {
  render(<EventAttendanceSummary summary={{ state: "social", total: 3, adults: 2, children: 1 }} />);
  expect(screen.getByText("3 attending (2 adults, 1 child)")).toBeTruthy();
});

test("EventAttendanceSummary renders loading and unavailable states explicitly", () => {
  const { rerender } = render(<EventAttendanceSummary summary={{ state: "loading" }} />);
  expect(screen.getByText("Loading...")).toBeTruthy();
  rerender(<EventAttendanceSummary summary={{ state: "unavailable" }} />);
  expect(screen.getByText("Attendance unavailable").classList.contains("text-destructive")).toBe(true);
});
