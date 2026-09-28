import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: the legacy Home-only event administration workflows (cancel, delete,
 * remind) and the legacy "Request to Join Club" dialog were unreachable dead
 * code and have been removed. Event Detail owns those flows now, and club
 * requests live on Club Detail / onboarding. This test fails if any of them
 * is re-introduced into HomePage.
 */
const src = readFileSync(join(__dirname, "HomePage.tsx"), "utf8");
const joinDialogSrc = readFileSync(
  join(__dirname, "../components/home/HomeJoinTeamDialog.tsx"),
  "utf8",
);
const homeJoinSource = `${src}\n${joinDialogSrc}`;

describe("HomePage legacy workflow removal", () => {
  const obsolete = [
    "clubDialogOpen",
    "selectedClubRole",
    "clubRequestMutation",
    "cancelDialogOpen",
    "eventToCancel",
    "cancelEventMutation",
    "remindDialogOpen",
    "eventToRemind",
    "nonRsvpCount",
    "loadingRemindCount",
    "remindMutation",
    "deleteDialogOpen",
    "eventToDelete",
    "SeriesPartialDeleteError",
    "deleteEventMutation",
    "canManageEvent",
  ];

  for (const symbol of obsolete) {
    it(`does not reference ${symbol}`, () => {
      expect(src).not.toMatch(new RegExp(`\\b${symbol}\\b`));
    });
  }

  it("does not render the obsolete event administration dialogs", () => {
    expect(src).not.toMatch(/RecurringEventActionDialog/);
    expect(src).not.toMatch(/RecurringCancelEventDialog/);
    expect(src).not.toMatch(/CancelEventConfirmDialog/);
  });

  it("does not render a Request to Join Club dialog", () => {
    expect(src).not.toMatch(/Request to Join Club/);
  });

  it("still renders and navigates through NextUpCarousel", () => {
    expect(src).toMatch(/NextUpCarousel/);
  });

  it("still exposes the live team/league join flow", () => {
    expect(src).toMatch(/\bteamDialogOpen\b/);
    expect(homeJoinSource).toMatch(/teamRequestMutation|Request to Join Team/);
  });
});
