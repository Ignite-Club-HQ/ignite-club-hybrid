export type EventAttendanceSummary =
  | { state: "players"; count: number }
  | { state: "social"; total: number; adults: number; children: number }
  | { state: "loading" }
  | { state: "unavailable" };

export function formatEventAttendanceSummary(summary: EventAttendanceSummary): string {
  if (summary.state === "loading") return "Loading...";
  if (summary.state === "unavailable") return "Attendance unavailable";
  if (summary.state === "players") {
    return `${summary.count} player${summary.count === 1 ? "" : "s"} attending`;
  }
  const adultLabel = `${summary.adults} adult${summary.adults === 1 ? "" : "s"}`;
  const childLabel = `${summary.children} child${summary.children === 1 ? "" : "ren"}`;
  return `${summary.total} attending (${adultLabel}, ${childLabel})`;
}

export interface EventLocationModel {
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  locationName?: string | null;
  legacyLocation?: string | null;
}

export function resolveEventMapAddress(location: EventLocationModel): string | null {
  return location.address?.trim() || location.legacyLocation?.trim() || null;
}

export function eventLocationLabels(location: EventLocationModel): string[] {
  const labels = [
    location.address?.trim(),
    [location.suburb, location.state, location.postcode].filter(Boolean).join(", "),
    location.locationName?.trim(),
    location.legacyLocation?.trim(),
  ].filter((label): label is string => Boolean(label));
  return [...new Set(labels)];
}

export interface EventPassiveFactsModel {
  opponent?: string | null;
  arrivalTime?: string | null;
  arrivalMinutes?: number | null;
  price?: number | null;
  eventType: "game" | "social" | "training";
}

export function formatEventPassiveFacts(model: EventPassiveFactsModel): {
  opponent: string | null;
  arrival: string | null;
  price: string | null;
} {
  return {
    opponent: model.eventType === "game" && model.opponent ? `vs ${model.opponent}` : null,
    arrival:
      model.eventType === "game" &&
      model.arrivalTime &&
      model.arrivalMinutes != null
        ? `Arrive by ${model.arrivalTime} (${model.arrivalMinutes} min before kickoff)`
        : null,
    price:
      model.eventType === "social" && model.price != null && model.price > 0
        ? `$${model.price.toFixed(2)} per person`
        : null,
  };
}

export type EventReminderAvailability = "hidden" | "enabled" | "pro-disabled";

export interface EventAdminActionModel {
  visible: boolean;
  showEdit: boolean;
  reminder: EventReminderAvailability;
  showResend: boolean;
  showCancel: boolean;
  showDelete: boolean;
}

export function getEventAdminActionLabels(
  model: EventAdminActionModel,
  eventTypeLabel: string,
): Array<{ label: string; enabled: boolean }> {
  if (!model.visible) return [];
  return [
    ...(model.showEdit ? [{ label: `Edit ${eventTypeLabel}`, enabled: true }] : []),
    ...(model.reminder !== "hidden"
      ? [{ label: "Send Reminders", enabled: model.reminder === "enabled" }]
      : []),
    ...(model.showResend ? [{ label: "Resend Invites", enabled: true }] : []),
    ...(model.showCancel ? [{ label: `Cancel ${eventTypeLabel}`, enabled: true }] : []),
    ...(model.showDelete ? [{ label: `Delete ${eventTypeLabel}`, enabled: true }] : []),
  ];
}

export function getEventLifecycleScopes(recurring: boolean): Array<"single" | "series"> {
  return recurring ? ["single", "series"] : ["single"];
}

export function getEventNotificationState(
  isPending: boolean,
  actionsDisabled: boolean,
): { sendLabel: string; sendDisabled: boolean } {
  return {
    sendLabel: isPending ? "Sending..." : "Send In-App",
    sendDisabled: isPending || actionsDisabled,
  };
}

export function resolveEventMatchScoreContract(input: {
  visible: boolean;
  opponent: string | null;
  canEdit: boolean;
  eventId: string;
  teamId: string | null;
  teamName?: string | null;
  sport?: string;
}): {
  eventId: string;
  teamId: string;
  teamName: string;
  opponent: string;
  sport?: string;
  canEdit: boolean;
} | null {
  if (!input.visible || !input.teamId || !input.opponent) return null;
  return {
    eventId: input.eventId,
    teamId: input.teamId,
    teamName: input.teamName || "Our Team",
    opponent: input.opponent,
    ...(input.sport ? { sport: input.sport } : {}),
    canEdit: input.canEdit,
  };
}

export function formatEventCalendarLabel(isoDate: string): string {
  const date = new Date(isoDate);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
  return `${dateLabel} at ${timeLabel}`;
}

export type InviteDeliveryMethod = "email" | "share";

export function getInviteDeliveryState(
  deliveryMethod: InviteDeliveryMethod,
  email: string,
): { showEmail: boolean; selectedAction: "Email" | "Share Link"; canSubmit: boolean } {
  const trimmedEmail = email.trim();
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail);
  return {
    showEmail: deliveryMethod === "email",
    selectedAction: deliveryMethod === "email" ? "Email" : "Share Link",
    canSubmit: deliveryMethod === "share" || validEmail,
  };
}

export function buildInviteSmsUrl(phone: string, message: string, isAndroid: boolean): string {
  const normalizedPhone = phone.replace(/[\s()-]/g, "");
  return `sms:${normalizedPhone}${isAndroid ? "?" : "&"}body=${encodeURIComponent(message.trim())}`;
}

export function buildInviteWhatsAppUrl(phone: string, message: string): string {
  const normalizedPhone = phone.replace(/\D/g, "");
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message.trim())}`;
}

export function formatInviteSuccessSummary(
  childNames: readonly string[],
  teamName: string,
  invitedEmail: string,
): string {
  const children = childNames.join(", ");
  return invitedEmail
    ? `${children} added to ${teamName}; Invite sent to ${invitedEmail}`
    : `${children} added to ${teamName}; Invite link created - share it with them`;
}

export function formatBulkInviteOutcome(
  result: { email: string; sent: boolean },
): "Sent" | "Failed" | "Link only" {
  if (result.sent) return "Sent";
  return result.email ? "Failed" : "Link only";
}

export function getInvitationFooterState(input: {
  wizardStep: 1 | 2 | 3;
  hasMemberIdentity: boolean;
  hasMemberName: boolean;
  selectedRole: "player" | "parent" | "coach" | "team_admin";
  hasNamedChild: boolean;
  deliveryMethod: InviteDeliveryMethod;
  email: string;
  isPending: boolean;
}): { canContinue: boolean; message: string | null } {
  if (input.wizardStep === 1) {
    return {
      canContinue: input.hasMemberName,
      message: input.hasMemberName ? null : "Enter a name to continue",
    };
  }
  if (input.wizardStep === 2 && input.selectedRole === "parent" && !input.hasNamedChild) {
    return { canContinue: false, message: "Add at least one child's name to continue." };
  }
  if (input.wizardStep === 2 && input.hasMemberIdentity && input.selectedRole !== "parent") {
    return { canContinue: true, message: null };
  }
  if (input.wizardStep === 3 && input.deliveryMethod === "email") {
    if (!input.email.trim()) {
      return { canContinue: false, message: "Enter an email address to send the invite." };
    }
    if (!getInviteDeliveryState("email", input.email).canSubmit) {
      return { canContinue: false, message: "That email doesn't look right" };
    }
  }
  return { canContinue: !input.isPending, message: null };
}

export type VaultStorageTone = "primary" | "warning" | "destructive";

export function getVaultStorageTone(storagePercentage: number): VaultStorageTone {
  if (storagePercentage >= 90) return "destructive";
  if (storagePercentage >= 70) return "warning";
  return "primary";
}

export function getVaultSelectedCount(photoCount: number, fileCount: number): number {
  return photoCount + fileCount;
}

export function getVaultExportState(photoCount: number, fileCount: number): {
  selectedCount: number;
  canExport: boolean;
  confirmationLabel: string;
} {
  const selectedCount = getVaultSelectedCount(photoCount, fileCount);
  return {
    selectedCount,
    canExport: selectedCount > 0,
    confirmationLabel: `Export ${selectedCount} Items as ZIP`,
  };
}

export function getVaultSelectedBytes(
  items: readonly { id: string; size: number }[],
  selectedIds: ReadonlySet<string>,
): number {
  return items.reduce((total, item) => total + (selectedIds.has(item.id) ? item.size : 0), 0);
}

export function canRenameVaultValue(value: string): boolean {
  return value.trim().length > 0;
}

export function getVaultMutationState(input: {
  kind: "photo" | "file" | "folder";
  permanent?: boolean;
  selectedCount?: number;
  deletingSelected?: boolean;
}): { title: string; confirmLabel: string; destructive: boolean; canConfirm: boolean } {
  if (input.kind === "photo") {
    return {
      title: input.permanent ? "Permanently Delete Photo" : "Move Photo to Trash",
      confirmLabel: input.permanent ? "Delete Permanently" : "Move to Trash",
      destructive: Boolean(input.permanent),
      canConfirm: true,
    };
  }
  if (input.kind === "file") {
    return {
      title: input.permanent ? "Permanently Delete File" : "Move File to Trash",
      confirmLabel: input.permanent ? "Delete Permanently" : "Move to Trash",
      destructive: Boolean(input.permanent),
      canConfirm: true,
    };
  }
  const count = input.selectedCount ?? 0;
  return {
    title: `Delete ${count} selected item${count === 1 ? "" : "s"}?`,
    confirmLabel: `Delete ${count} Item${count === 1 ? "" : "s"}`,
    destructive: true,
    canConfirm: count > 0 && !input.deletingSelected,
  };
}

export interface PitchBoardRestoreInput {
  currentPath: string;
  storedPath: string | null;
  open: boolean;
  openedAt: number | null;
  now: number;
  mounted: boolean;
  restoreWindowOpen: boolean;
}

export function resolvePitchBoardRestore(input: PitchBoardRestoreInput): {
  navigateTo: string | null;
  clearMarker: boolean;
} {
  if (!input.restoreWindowOpen || input.mounted || !input.open || !input.storedPath) {
    return { navigateTo: null, clearMarker: false };
  }
  if (input.openedAt == null || input.now - input.openedAt >= 12 * 60 * 60 * 1000) {
    return { navigateTo: null, clearMarker: true };
  }
  const [path, query = ""] = input.storedPath.split("?");
  const [currentPath, currentQuery = ""] = input.currentPath.split("?");
  if (path === "/" || path === "/home" || ["/auth", "/reset-password", "/verify-reset-code", "/complete-profile", "/terms", "/privacy"].includes(currentPath)) {
    return { navigateTo: null, clearMarker: false };
  }
  if (currentPath === path && new URLSearchParams(currentQuery).get("openPitchBoard") === "1") {
    return { navigateTo: null, clearMarker: false };
  }
  const params = new URLSearchParams(query);
  params.set("openPitchBoard", "1");
  return { navigateTo: `${path}?${params.toString()}`, clearMarker: true };
}

export interface AutoSubAdvancedOverrides {
  standardIntervalFloorSec?: number;
  standardTargetIntervalSec?: number;
  frequentIntervalFloorSec?: number;
  minShiftSeconds?: number;
  halftimeGuardSeconds?: number;
  maxSpreadOverrideSec?: number;
  playerPriorityOrder?: readonly string[];
}

export type AutoSubNumericOverride = Exclude<
  keyof AutoSubAdvancedOverrides,
  "playerPriorityOrder"
>;

const AUTO_SUB_ADVANCED_DEFAULTS: Record<
  Exclude<AutoSubNumericOverride, "maxSpreadOverrideSec">,
  number
> = {
  standardTargetIntervalSec: 420,
  standardIntervalFloorSec: 240,
  frequentIntervalFloorSec: 180,
  minShiftSeconds: 180,
  halftimeGuardSeconds: 180,
};

const AUTO_SUB_ADVANCED_CONTROLS: ReadonlyArray<{
  key: AutoSubNumericOverride;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  {
    key: "standardTargetIntervalSec",
    label: "Fairer minutes vs fewer stoppages",
    min: 180,
    max: 900,
    step: 30,
  },
  {
    key: "maxSpreadOverrideSec",
    label: "Max playing-time spread",
    min: 120,
    max: 720,
    step: 30,
  },
  {
    key: "standardIntervalFloorSec",
    label: "Space out substitution moments",
    min: 120,
    max: 600,
    step: 30,
  },
  {
    key: "frequentIntervalFloorSec",
    label: "Space out substitution moments (Frequent mode)",
    min: 60,
    max: 420,
    step: 15,
  },
  {
    key: "minShiftSeconds",
    label: "Allow short cameos vs protect player shifts",
    min: 60,
    max: 360,
    step: 15,
  },
  {
    key: "halftimeGuardSeconds",
    label: "Allow halftime subs vs keep halftime clean",
    min: 0,
    max: 420,
    step: 15,
  },
];

export function getAutoSubAdvancedSettingsState(input: {
  open: boolean;
  overrides: Readonly<AutoSubAdvancedOverrides>;
  readOnly: boolean;
  defaultMaxSpreadMinutes: number;
}): {
  customCount: number;
  controls: Array<{
    key: AutoSubNumericOverride;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    disabled: boolean;
    canReset: boolean;
  }>;
  canResetAll: boolean;
  controlledMessage: string | null;
} {
  const customCount = Object.values(input.overrides)
    .filter((value) => value !== undefined).length;
  const defaultMaxSpreadSec = Math.round(input.defaultMaxSpreadMinutes * 60);
  const defaults: Record<AutoSubNumericOverride, number> = {
    ...AUTO_SUB_ADVANCED_DEFAULTS,
    maxSpreadOverrideSec: defaultMaxSpreadSec,
  };
  return {
    customCount,
    controls: input.open
      ? AUTO_SUB_ADVANCED_CONTROLS.map(({ key, label, min, max, step }) => ({
          key,
          label,
          value: input.overrides[key] ?? defaults[key],
          min,
          max,
          step,
          disabled: input.readOnly,
          canReset: !input.readOnly && input.overrides[key] !== undefined,
        }))
      : [],
    canResetAll: !input.readOnly && customCount > 0,
    controlledMessage: input.readOnly
      ? "These thresholds are controlled by the parent screen and can't be changed here."
      : null,
  };
}

export function updateAutoSubAdvancedOverride(
  overrides: Readonly<AutoSubAdvancedOverrides>,
  key: AutoSubNumericOverride,
  next: number | undefined,
  readOnly = false,
): AutoSubAdvancedOverrides {
  if (readOnly) return { ...overrides };
  const merged: AutoSubAdvancedOverrides = { ...overrides };
  if (next === undefined) delete merged[key];
  else merged[key] = next;
  return merged;
}

export function resetAutoSubAdvancedOverrides(
  overrides: Readonly<AutoSubAdvancedOverrides>,
  readOnly = false,
): AutoSubAdvancedOverrides {
  return readOnly ? { ...overrides } : {};
}

export type AutoSubPlanMode = 1 | 2;

const AUTO_SUB_PLAN_MODES: ReadonlyArray<{
  id: AutoSubPlanMode;
  title: string;
  tradeoff: string;
}> = [
  {
    id: 1,
    title: "Standard",
    tradeoff: "Fewer substitutions, longer shifts. Minutes may differ a little more between players.",
  },
  {
    id: 2,
    title: "Frequent",
    tradeoff: "More substitutions, tighter rotation. Minutes even out faster across the squad.",
  },
];

export function getAutoSubPlanModeState(input: {
  activeMode: AutoSubPlanMode;
  readOnly: boolean;
  disabledModes?: readonly AutoSubPlanMode[];
}): Array<{
  id: AutoSubPlanMode;
  title: string;
  tradeoff: string;
  active: boolean;
  disabled: boolean;
  badge: "On" | "Unavailable" | null;
  unavailableReason: string | null;
}> {
  if (input.readOnly) return [];
  return AUTO_SUB_PLAN_MODES.map((mode) => {
    const disabled = input.disabledModes?.includes(mode.id) ?? false;
    const active = input.activeMode === mode.id;
    return {
      ...mode,
      active,
      disabled,
      badge: disabled ? "Unavailable" : active ? "On" : null,
      unavailableReason: disabled
        ? "Not available for this squad size and match length"
        : null,
    };
  });
}

export function requestAutoSubPlanMode(input: {
  requestedMode: AutoSubPlanMode;
  readOnly: boolean;
  disabledModes?: readonly AutoSubPlanMode[];
}): AutoSubPlanMode | null {
  if (input.readOnly || input.disabledModes?.includes(input.requestedMode)) return null;
  return input.requestedMode;
}

export function getAutoSubPlanStatus(input: {
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}): {
  needsAdjustment: boolean;
  totalSubsLabel: string;
  spreadLabel: string;
  shortShiftsLabel: string;
  spreadTone: "attention" | "normal";
  shortShiftsTone: "attention" | "calm";
} {
  const hasSpread = input.spreadMin > 6;
  const hasShortShifts = input.shortShifts > 0;
  return {
    needsAdjustment: input.hasHalftimeClash || hasSpread || hasShortShifts,
    totalSubsLabel: String(input.totalSubs),
    spreadLabel: `${input.spreadMin.toFixed(1)}m`,
    shortShiftsLabel: String(input.shortShifts),
    spreadTone: hasSpread ? "attention" : "normal",
    shortShiftsTone: hasShortShifts ? "attention" : "calm",
  };
}

export type AutoSubGoalkeeperRole = "full" | "1h" | "2h";

export function getAutoSubPlayerMinutesState(input: {
  player: { name: string; number?: number };
  predictedMinutes: number;
  percentageOfGame: number;
  startsOnPitch: boolean;
  gkRole?: AutoSubGoalkeeperRole;
  shortShifts?: number;
  bounceBacks?: number;
  draggable: boolean;
}): {
  playerName: string;
  numberLabel: string;
  lineupLabel: "Start" | "Bench";
  forecastLabel: string;
  goalkeeperLabel: "GK" | "GK 1H" | "GK 2H" | null;
  warningLabels: string[];
  dragLabel: string | null;
} {
  const goalkeeperLabel = input.gkRole === "full"
    ? "GK"
    : input.gkRole === "1h"
      ? "GK 1H"
      : input.gkRole === "2h"
        ? "GK 2H"
        : null;
  const warningLabels: string[] = [];
  if ((input.shortShifts ?? 0) > 0) warningLabels.push(`${input.shortShifts} very short`);
  if ((input.bounceBacks ?? 0) > 0) warningLabels.push(`${input.bounceBacks} bounce`);
  return {
    playerName: input.player.name,
    numberLabel: input.player.number == null ? "?" : String(input.player.number),
    lineupLabel: input.startsOnPitch ? "Start" : "Bench",
    forecastLabel: `${input.predictedMinutes}' (${input.percentageOfGame}%)`,
    goalkeeperLabel,
    warningLabels,
    dragLabel: input.draggable
      ? `Reorder ${input.player.name} playing-time priority`
      : null,
  };
}

export type VaultPhotoLoadState = "pending" | "loaded" | "error";
export type VaultPhotoAction = "download" | "rename" | "delete";

export function getVaultPhotoPresentation(input: {
  photo: { id: string; title?: string; fileUrl?: string; imageUrl?: string };
  signedUrl?: string | null;
  signedUrlLoading: boolean;
  loadState: VaultPhotoLoadState;
  selectionMode: boolean;
  canDelete: boolean;
  canRename: boolean;
  hasDownloadHandler: boolean;
  hasRenameHandler: boolean;
}): {
  phase: "empty" | "loading" | "error" | "ready";
  photoUrl: string | null;
  alt: string;
  downloadName: string;
  selectedAction: "toggle-selection" | "open";
  actions: VaultPhotoAction[];
} {
  const rawPhotoUrl = input.photo.fileUrl || input.photo.imageUrl || null;
  const photoUrl = input.signedUrl || rawPhotoUrl;
  const actions: VaultPhotoAction[] = [];
  if (input.hasDownloadHandler) actions.push("download");
  if (input.canRename && input.hasRenameHandler) actions.push("rename");
  if (input.canDelete) actions.push("delete");
  const common = {
    photoUrl,
    alt: input.photo.title || "Photo",
    downloadName: input.photo.title || `photo-${input.photo.id}.jpg`,
    selectedAction: input.selectionMode ? "toggle-selection" as const : "open" as const,
    actions: input.selectionMode ? [] : actions,
  };
  if (!rawPhotoUrl) return { phase: "empty", ...common };
  if (input.signedUrlLoading || input.loadState === "pending") {
    return { phase: "loading", ...common };
  }
  if (input.loadState === "error") return { phase: "error", ...common };
  return { phase: "ready", ...common };
}
