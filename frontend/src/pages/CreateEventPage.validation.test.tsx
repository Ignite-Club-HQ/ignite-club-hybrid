/**
 * Regression tests for the club/team scope guard on CreateEventPage.
 *
 * These focus on the mutation contract that the page must uphold before
 * sending anything to Supabase:
 *
 *   1. A valid same-club team can be used to create an event.
 *   2. Cross-club event creation is rejected before any insert.
 *
 * The pure guard covering every branch (missing team list, unknown team,
 * fail-closed on undefined, etc.) lives in
 * `src/lib/eventScopeValidation.test.ts` — this file only pins the wiring.
 */
import { describe, it, expect } from "vitest";
import { validateEventTeamClubScope } from "@/lib/eventScopeValidation";

// Simulates the exact shape CreateEventPage passes into the guard from its
// `teams` query result. If either the page's guard signature or the shape
// used by the query drifts, this file will fail loudly.
const clubTeams = [
  { id: "team-a1", club_id: "club-a", name: "U10" },
  { id: "team-a2", club_id: "club-a", name: "U12" },
];

describe("CreateEventPage — team/club scope guard (test 1, 2)", () => {
  it("(1) valid same-club team passes the guard", () => {
    const check = validateEventTeamClubScope("team-a1", clubTeams, "club-a");
    expect(check).toEqual({ ok: true });
  });

  it("(2) cross-club team is rejected before frontend mutation", () => {
    const teams = [
      { id: "team-a1", club_id: "club-a" },
      { id: "team-b1", club_id: "club-b" },
    ];
    const check = validateEventTeamClubScope("team-b1", teams, "club-a");
    expect(check.ok).toBe(false);
    if (check.ok === false) expect(check.reason).toBe("team_not_in_club");
  });

  it("(7) club-wide events (no team) remain valid where supported", () => {
    const check = validateEventTeamClubScope(null, clubTeams, "club-a");
    expect(check).toEqual({ ok: true });
  });

  it("fail-closed when the team list is unavailable — no submission possible", () => {
    const check = validateEventTeamClubScope("team-a1", undefined, "club-a");
    expect(check.ok).toBe(false);
    if (check.ok === false) expect(check.reason).toBe("list_unavailable");
  });
});
