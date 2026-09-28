import { describe, expect, it } from "vitest";
import { isEventUpcomingForActions, resolveEventAdminActions } from "./eventAdminActionPolicy";

describe("event admin action policy", () => {
  it("uses event date plus end time, then start time, then end-of-day for upcoming status", () => {
    const nowMs = new Date("2026-08-12T12:00:00Z").getTime();
    expect(isEventUpcomingForActions({ eventDate: "2026-08-12T10:00:00Z", endTime: "13:00", nowMs })).toBe(true);
    expect(isEventUpcomingForActions({ eventDate: "2026-08-12", startTime: "11:00", nowMs })).toBe(false);
    expect(isEventUpcomingForActions({ eventDate: "2026-08-12", nowMs })).toBe(true);
  });
  it("hides the complete menu from non-managers", () => {
    expect(resolveEventAdminActions({
      canManageEvent: false, isCancelled: false, isUpcoming: true,
      canSendReminders: true, proLoading: false,
    })).toEqual({ visible: false, showEdit: false, reminder: "hidden", showResend: false, showCancel: false, showDelete: false });
  });
  it("offers edit, reminder, resend, cancel and delete for an eligible Pro manager", () => {
    expect(resolveEventAdminActions({
      canManageEvent: true, isCancelled: false, isUpcoming: true,
      canSendReminders: true, proLoading: false,
    })).toEqual({ visible: true, showEdit: true, reminder: "enabled", showResend: true, showCancel: true, showDelete: true });
  });
  it("shows the disabled Pro reminder affordance only after entitlement resolves", () => {
    expect(resolveEventAdminActions({
      canManageEvent: true, isCancelled: false, isUpcoming: true,
      canSendReminders: false, proLoading: false,
    }).reminder).toBe("pro-disabled");
    expect(resolveEventAdminActions({
      canManageEvent: true, isCancelled: false, isUpcoming: true,
      canSendReminders: false, proLoading: true,
    }).reminder).toBe("hidden");
  });
  it("leaves only deletion for cancelled events and hides time-sensitive actions for past events", () => {
    expect(resolveEventAdminActions({
      canManageEvent: true, isCancelled: true, isUpcoming: true,
      canSendReminders: true, proLoading: false,
    })).toMatchObject({ visible: true, showEdit: false, reminder: "hidden", showResend: false, showCancel: false, showDelete: true });
    expect(resolveEventAdminActions({
      canManageEvent: true, isCancelled: false, isUpcoming: false,
      canSendReminders: true, proLoading: false,
    })).toMatchObject({ showEdit: true, reminder: "hidden", showResend: false, showCancel: true, showDelete: true });
  });
});
