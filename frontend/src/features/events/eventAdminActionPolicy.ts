export type ReminderMenuState = "hidden" | "enabled" | "pro-disabled";

export function isEventUpcomingForActions(input: {
  eventDate?: string | null;
  endTime?: string | null;
  startTime?: string | null;
  nowMs: number;
}): boolean {
  const date = input.eventDate?.split("T")[0] || input.eventDate;
  return new Date(`${date}T${input.endTime || input.startTime || "23:59"}`).getTime() >= input.nowMs;
}

export function resolveEventAdminActions(input: {
  canManageEvent: boolean;
  isCancelled: boolean;
  isUpcoming: boolean;
  canSendReminders: boolean;
  proLoading: boolean;
}) {
  const active = input.canManageEvent && !input.isCancelled;
  const reminder: ReminderMenuState = !active || !input.isUpcoming
    ? "hidden"
    : input.canSendReminders
      ? "enabled"
      : input.proLoading ? "hidden" : "pro-disabled";
  return {
    visible: input.canManageEvent,
    showEdit: active,
    reminder,
    showResend: active && input.isUpcoming,
    showCancel: active,
    showDelete: input.canManageEvent,
  };
}
