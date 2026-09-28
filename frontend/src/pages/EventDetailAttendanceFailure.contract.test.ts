import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(resolve(__dirname, "EventDetailPage.tsx"), "utf8");
const dialogSource = readFileSync(
  resolve(__dirname, "../components/event/EventDetailActionDialogs.tsx"),
  "utf8",
);
const rsvpResponseSource = readFileSync(
  resolve(__dirname, "../components/event/EventRsvpResponseSection.tsx"),
  "utf8",
);
const source = `${pageSource}\n${dialogSource}\n${rsvpResponseSource}`;

/**
 * Event Detail attendance failure handling.
 *
 * A failed RSVP read must never be rendered as a valid empty roster, and every
 * attendance-dependent action must be disabled until a successful read lands.
 */
describe("Event Detail attendance failure handling", () => {
  it("retains the RSVP query error, loading and refetch state", () => {
    expect(source).toMatch(/error: rsvpsError/);
    expect(source).toMatch(/isLoading: rsvpsLoading/);
    expect(source).toMatch(/isFetching: rsvpsFetching/);
    expect(source).toMatch(/refetch: refetchRsvps/);
  });

  it("treats a failed read as unavailable rather than empty", () => {
    expect(source).toContain("const attendanceUnavailable = !!rsvpsError && !rsvps;");
    expect(source).toContain("if (attendanceUnavailable) return attendanceAlert;");
  });

  it("renders the attendance failure alert exactly once", () => {
    const renders = source.match(/return attendanceAlert;|\{attendanceUnavailable && attendanceAlert\}/g) || [];
    expect(renders).toHaveLength(1);
    // exactly one attendance retry, scoped to the RSVP query only
    const retries = source.match(/void refetchRsvps\(\)/g) || [];
    expect(retries).toHaveLength(1);
    const fatalAlerts = source.match(/Attendance couldn’t be loaded\. Check your connection and try again\./g) || [];
    expect(fatalAlerts).toHaveLength(1);
  });



  it("shows an accessible alert with a Try again retry of the exact query", () => {
    expect(source).toMatch(/role="alert"[\s\S]{0,400}Attendance couldn’t be loaded\. Check your connection and try again\./);
    expect(source).toMatch(/Try again/);
    expect(source).toContain("void refetchRsvps()");
  });


  it("shows an attendance-specific loading state instead of zero attendance", () => {
    expect(source).toContain("Loading attendance…");
    expect(source).toContain("if (!rsvps && attendanceInitialLoading)");
  });

  it("disables RSVP and attendance-dependent actions while unavailable", () => {
    expect(source).toContain(
      "const attendanceActionsDisabled = attendanceUnavailable || attendanceInitialLoading;",
    );
    const disabledUses = source.match(/attendanceActionsDisabled/g) || [];
    // declaration + personal, child, mini-league player, remind, resend
    expect(disabledUses.length).toBeGreaterThanOrEqual(6);
    expect(source).toContain("disabled={rsvpMutation.isPending || attendanceActionsDisabled");
    expect(source).toContain("disabled={childRsvpMutation.isPending || attendanceActionsDisabled}");
    expect(source).toContain(
      "disabled={parentLeaguePlayerRsvpMutation.isPending || attendanceActionsDisabled}",
    );
    expect(source).toContain("disabled={remindMutation.isPending || attendanceActionsDisabled}");
    expect(source).toContain(
      "disabled={resendInvitesMutation.isPending || attendanceActionsDisabled}",
    );
  });

  it("keeps cached attendance stable during a background refetch", () => {
    // The unavailable flag requires an absent cache, so a background refetch
    // error never blanks previously loaded attendance.
    expect(source).not.toContain("const attendanceUnavailable = !!rsvpsError;");
    expect(source).toContain("(rsvpsFetching && !rsvps)");
  });
});
