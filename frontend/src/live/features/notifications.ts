import { connectLiveNotificationQueue } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { unwrapCandid, unwrapCandidOpt } from "./candid";

/**
 * Notifications feature -> notification_queue canister.
 *
 * The canister is a durable enqueue/claim/ack pipeline: the app enqueues,
 * delivery workers claim and acknowledge. Only the app-facing surface
 * (enqueue + status lookup) is exposed here; claim/ack/fail/recover are
 * worker operations and belong to the delivery service, not the browser.
 *
 * NOTE: untested against a live canister until deployment.
 */

export interface LiveNotificationInput {
  /** Client-generated id, doubles as the idempotency key namespace. */
  id: string;
  userId: string;
  clubId: string;
  kind: string;
  body: string;
  idempotencyKey: string;
}

export async function enqueueLiveNotification(
  ctx: FeatureBackendContext,
  input: LiveNotificationInput,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.enqueue(input.id, input.userId, input.clubId, input.kind, input.body, input.idempotencyKey),
    "Enqueue notification",
  );
}

export interface LiveNotificationFanOutInput {
  userIds: string[];
  clubId: string;
  kind: string;
  body: string;
  /**
   * Per-attempt unique prefix; the canister derives each recipient's id as
   * `<prefix>-<userId>`, so a retried call with the same prefix is
   * idempotent per recipient and a new prefix re-notifies.
   */
  idempotencyKeyPrefix: string;
  relatedId?: string | null;
}

/**
 * Browser fan-out: one update call enqueues the same notification for many
 * recipients (bulk reminders, duty notices, invites) instead of one call
 * per recipient. Provisional: recipients are browser-supplied account ids
 * until account ids are bound to principals (identity_access).
 */
export async function fanOutLiveNotifications(
  ctx: FeatureBackendContext,
  input: LiveNotificationFanOutInput,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.fan_out(
      input.userIds,
      input.clubId,
      input.kind,
      input.body,
      input.idempotencyKeyPrefix,
      input.relatedId ? [input.relatedId] : [],
    ),
    "Fan out notifications",
  );
}

export async function getLiveNotification(ctx: FeatureBackendContext, notificationId: string) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandidOpt(await actor.get_notification(notificationId), "Get notification");
}

/**
 * Browser inbox surface. The canister stores the app account id as plain
 * text and cannot verify it against the caller's principal — inbox reads and
 * mutations are provisional until account ids are bound to principals
 * (identity_access), matching the rest of the live feature layer.
 */
export async function listLiveInbox(
  ctx: FeatureBackendContext,
  userId: string,
  clubId: string | null,
  limit = 500,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_inbox(userId, clubId ? [clubId] : [], limit),
    "List inbox",
  );
}

export async function markLiveNotificationRead(ctx: FeatureBackendContext, notificationId: string) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(actor.mark_read(notificationId), "Mark notification read");
}

export async function markAllLiveNotificationsRead(
  ctx: FeatureBackendContext,
  userId: string,
  clubId: string | null,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.mark_all_read(userId, clubId ? [clubId] : []),
    "Mark all notifications read",
  );
}

export async function deleteLiveNotification(ctx: FeatureBackendContext, notificationId: string) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_notification(notificationId), "Delete notification");
}

export async function clearLiveInbox(
  ctx: FeatureBackendContext,
  userId: string,
  clubId: string | null,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.clear_inbox(userId, clubId ? [clubId] : []),
    "Clear inbox",
  );
}

// ---------------------------------------------------------------------------
// Scheduled messages (schedule_message / list_scheduled / cancel_scheduled).
//
// mark_sent / mark_failed / due_scheduled are worker-guarded canister methods
// (the delivery worker claims due messages and reports outcome) and are
// intentionally NOT exposed here — the browser only schedules, lists, and
// cancels its own messages.
// ---------------------------------------------------------------------------

export type LiveScheduledChatType =
  | "team"
  | "club"
  | "group"
  | "direct"
  | "club_admin"
  | "broadcast";

export type LiveScheduledRecurrence = "none" | "daily" | "weekly" | "monthly";

export type LiveScheduledStatus = "pending" | "sent" | "failed" | "cancelled";

export interface LiveScheduledMessage {
  id: string;
  author: string;
  chatType: LiveScheduledChatType;
  teamId: string | null;
  clubId: string | null;
  groupId: string | null;
  conversationId: string | null;
  body: string;
  imageUrl: string | null;
  replyToId: string | null;
  scheduledForMs: number;
  status: LiveScheduledStatus;
  sentMessageId: string | null;
  errorMessage: string | null;
  attemptedAtMs: number | null;
  recurrence: LiveScheduledRecurrence;
  recurrenceUntilMs: number | null;
  recurrenceParentId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

function chatTypeToCandid(chatType: LiveScheduledChatType) {
  switch (chatType) {
    case "team":
      return { Team: null };
    case "club":
      return { Club: null };
    case "group":
      return { Group: null };
    case "direct":
      return { Direct: null };
    case "club_admin":
      return { ClubAdmin: null };
    case "broadcast":
      return { Broadcast: null };
  }
}

function chatTypeFromCandid(chatType: unknown): LiveScheduledChatType {
  if (chatType && typeof chatType === "object") {
    if ("Team" in (chatType as object)) return "team";
    if ("Club" in (chatType as object)) return "club";
    if ("Group" in (chatType as object)) return "group";
    if ("Direct" in (chatType as object)) return "direct";
    if ("ClubAdmin" in (chatType as object)) return "club_admin";
    if ("Broadcast" in (chatType as object)) return "broadcast";
  }
  throw new Error(`Unrecognized scheduled message chat type: ${JSON.stringify(chatType)}`);
}

/** Recurrence values map 1:1 to the canister's `none/daily/weekly/monthly`. */
function recurrenceToCandid(recurrence: LiveScheduledRecurrence) {
  switch (recurrence) {
    case "none":
      return { None: null };
    case "daily":
      return { Daily: null };
    case "weekly":
      return { Weekly: null };
    case "monthly":
      return { Monthly: null };
  }
}

function recurrenceFromCandid(recurrence: unknown): LiveScheduledRecurrence {
  if (recurrence && typeof recurrence === "object") {
    if ("None" in (recurrence as object)) return "none";
    if ("Daily" in (recurrence as object)) return "daily";
    if ("Weekly" in (recurrence as object)) return "weekly";
    if ("Monthly" in (recurrence as object)) return "monthly";
  }
  throw new Error(`Unrecognized recurrence: ${JSON.stringify(recurrence)}`);
}

function statusFromCandid(status: unknown): LiveScheduledStatus {
  if (status && typeof status === "object") {
    if ("Pending" in (status as object)) return "pending";
    if ("Sent" in (status as object)) return "sent";
    if ("Failed" in (status as object)) return "failed";
    if ("Cancelled" in (status as object)) return "cancelled";
  }
  throw new Error(`Unrecognized scheduled message status: ${JSON.stringify(status)}`);
}

function fromCandidScheduledMessage(row: {
  id: string;
  author: string;
  chat_type: unknown;
  team_id: [] | [string];
  club_id: [] | [string];
  group_id: [] | [string];
  conversation_id: [] | [string];
  body: string;
  image_url: [] | [string];
  reply_to_id: [] | [string];
  scheduled_for_ms: bigint;
  status: unknown;
  sent_message_id: [] | [string];
  error_message: [] | [string];
  attempted_at_ms: [] | [bigint];
  recurrence: unknown;
  recurrence_until_ms: [] | [bigint];
  recurrence_parent_id: [] | [string];
  created_at_ms: bigint;
  updated_at_ms: bigint;
}): LiveScheduledMessage {
  return {
    id: row.id,
    author: row.author,
    chatType: chatTypeFromCandid(row.chat_type),
    teamId: row.team_id[0] ?? null,
    clubId: row.club_id[0] ?? null,
    groupId: row.group_id[0] ?? null,
    conversationId: row.conversation_id[0] ?? null,
    body: row.body,
    imageUrl: row.image_url[0] ?? null,
    replyToId: row.reply_to_id[0] ?? null,
    scheduledForMs: Number(row.scheduled_for_ms),
    status: statusFromCandid(row.status),
    sentMessageId: row.sent_message_id[0] ?? null,
    errorMessage: row.error_message[0] ?? null,
    attemptedAtMs: row.attempted_at_ms[0] != null ? Number(row.attempted_at_ms[0]) : null,
    recurrence: recurrenceFromCandid(row.recurrence),
    recurrenceUntilMs: row.recurrence_until_ms[0] != null ? Number(row.recurrence_until_ms[0]) : null,
    recurrenceParentId: row.recurrence_parent_id[0] ?? null,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

export interface LiveScheduleMessageInput {
  id: string;
  author: string;
  chatType: LiveScheduledChatType;
  teamId?: string | null;
  clubId?: string | null;
  groupId?: string | null;
  conversationId?: string | null;
  body: string;
  imageUrl?: string | null;
  replyToId?: string | null;
  scheduledForMs: number;
  recurrence?: LiveScheduledRecurrence;
  recurrenceUntilMs?: number | null;
}

/**
 * Provisional: `author` is the browser-supplied account id (principal text
 * in the ICP branch), matching the rest of this live feature layer until
 * account ids are bound to principals (identity_access).
 */
export async function scheduleLiveMessage(
  ctx: FeatureBackendContext,
  input: LiveScheduleMessageInput,
): Promise<LiveScheduledMessage> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const result = await unwrapCandid(
    actor.schedule_message(
      input.id,
      input.author,
      chatTypeToCandid(input.chatType),
      input.teamId ? [input.teamId] : [],
      input.clubId ? [input.clubId] : [],
      input.groupId ? [input.groupId] : [],
      input.conversationId ? [input.conversationId] : [],
      input.body,
      input.imageUrl ? [input.imageUrl] : [],
      input.replyToId ? [input.replyToId] : [],
      BigInt(Math.trunc(input.scheduledForMs)),
      recurrenceToCandid(input.recurrence ?? "none"),
      input.recurrenceUntilMs != null ? [BigInt(Math.trunc(input.recurrenceUntilMs))] : [],
    ),
    "Schedule message",
  );
  return fromCandidScheduledMessage(result);
}

/**
 * Lists scheduled messages for `author`, optionally filtered to one target
 * thread (`target` mirrors `targetKey` in useScheduledMessages.ts, but the
 * canister itself only filters by author — thread filtering happens
 * client-side, same as the equivalent Supabase query shape).
 */
export async function listLiveScheduledMessages(
  ctx: FeatureBackendContext,
  author: string,
): Promise<LiveScheduledMessage[]> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const rows = await unwrapCandid(actor.list_scheduled(author, []), "List scheduled messages");
  return rows.map(fromCandidScheduledMessage);
}

export async function cancelLiveScheduledMessage(
  ctx: FeatureBackendContext,
  id: string,
  author: string,
): Promise<LiveScheduledMessage> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const result = await unwrapCandid(actor.cancel_scheduled(id, author), "Cancel scheduled message");
  return fromCandidScheduledMessage(result);
}

export interface LiveUpdateScheduledMessageInput {
  id: string;
  author: string;
  body?: string | null;
  imageUrl?: string | null;
  scheduledForMs?: number | null;
  recurrence?: LiveScheduledRecurrence | null;
  recurrenceUntilMs?: number | null;
}

export async function updateLiveScheduledMessage(
  ctx: FeatureBackendContext,
  input: LiveUpdateScheduledMessageInput,
): Promise<LiveScheduledMessage> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const result = await unwrapCandid(
    actor.update_scheduled_message(
      input.id,
      input.author,
      input.body !== undefined && input.body !== null ? [input.body] : [],
      input.imageUrl !== undefined && input.imageUrl !== null ? [input.imageUrl] : [],
      input.scheduledForMs != null ? [BigInt(Math.trunc(input.scheduledForMs))] : [],
      input.recurrence != null ? [recurrenceToCandid(input.recurrence)] : [],
      input.recurrenceUntilMs != null ? [BigInt(Math.trunc(input.recurrenceUntilMs))] : [],
    ),
    "Update scheduled message",
  );
  return fromCandidScheduledMessage(result);
}

// ---------------------------------------------------------------------------
// Notification preferences (get_preferences / upsert_preferences).
//
// fan_out already filters recipients by stored preferences canister-side, so
// a preference upsert here takes effect on the very next fan-out call — there
// is no separate "sync" step like the Supabase branch's edge functions.
// ---------------------------------------------------------------------------

export interface LiveNotificationPreferences {
  user: string;
  messagesEnabled: boolean;
  eventsEnabled: boolean;
  mediaEnabled: boolean;
  membershipEnabled: boolean;
  pitchBoardEnabled: boolean;
  rewardsEnabled: boolean;
  adminEnabled: boolean;
  pomEnabled: boolean;
  showMessagePreview: boolean;
  emailMessagesEnabled: boolean;
  emailEventsEnabled: boolean;
  emailMediaEnabled: boolean;
  emailMembershipEnabled: boolean;
  emailAdminEnabled: boolean;
  emailPitchBoardEnabled: boolean;
  emailRewardsEnabled: boolean;
  emailPomEnabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export type LiveNotificationPreferencesInput = Omit<
  LiveNotificationPreferences,
  "user" | "createdAtMs" | "updatedAtMs"
>;

function preferencesInputToCandid(input: LiveNotificationPreferencesInput) {
  return {
    messages_enabled: input.messagesEnabled,
    events_enabled: input.eventsEnabled,
    media_enabled: input.mediaEnabled,
    membership_enabled: input.membershipEnabled,
    pitch_board_enabled: input.pitchBoardEnabled,
    rewards_enabled: input.rewardsEnabled,
    admin_enabled: input.adminEnabled,
    pom_enabled: input.pomEnabled,
    show_message_preview: input.showMessagePreview,
    email_messages_enabled: input.emailMessagesEnabled,
    email_events_enabled: input.emailEventsEnabled,
    email_media_enabled: input.emailMediaEnabled,
    email_membership_enabled: input.emailMembershipEnabled,
    email_admin_enabled: input.emailAdminEnabled,
    email_pitch_board_enabled: input.emailPitchBoardEnabled,
    email_rewards_enabled: input.emailRewardsEnabled,
    email_pom_enabled: input.emailPomEnabled,
  };
}

function preferencesFromCandid(row: {
  user: string;
  messages_enabled: boolean;
  events_enabled: boolean;
  media_enabled: boolean;
  membership_enabled: boolean;
  pitch_board_enabled: boolean;
  rewards_enabled: boolean;
  admin_enabled: boolean;
  pom_enabled: boolean;
  show_message_preview: boolean;
  email_messages_enabled: boolean;
  email_events_enabled: boolean;
  email_media_enabled: boolean;
  email_membership_enabled: boolean;
  email_admin_enabled: boolean;
  email_pitch_board_enabled: boolean;
  email_rewards_enabled: boolean;
  email_pom_enabled: boolean;
  created_at_ms: bigint;
  updated_at_ms: bigint;
}): LiveNotificationPreferences {
  return {
    user: row.user,
    messagesEnabled: row.messages_enabled,
    eventsEnabled: row.events_enabled,
    mediaEnabled: row.media_enabled,
    membershipEnabled: row.membership_enabled,
    pitchBoardEnabled: row.pitch_board_enabled,
    rewardsEnabled: row.rewards_enabled,
    adminEnabled: row.admin_enabled,
    pomEnabled: row.pom_enabled,
    showMessagePreview: row.show_message_preview,
    emailMessagesEnabled: row.email_messages_enabled,
    emailEventsEnabled: row.email_events_enabled,
    emailMediaEnabled: row.email_media_enabled,
    emailMembershipEnabled: row.email_membership_enabled,
    emailAdminEnabled: row.email_admin_enabled,
    emailPitchBoardEnabled: row.email_pitch_board_enabled,
    emailRewardsEnabled: row.email_rewards_enabled,
    emailPomEnabled: row.email_pom_enabled,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/**
 * Provisional: `user` is the browser-supplied account id. In the ICP branch
 * callers pass `ctx.identity.getPrincipal().toText()` so the stored key is
 * the signed-in principal, matching the rest of this live feature layer
 * until account ids are bound to principals (identity_access).
 */
export async function getLiveNotificationPreferences(
  ctx: FeatureBackendContext,
  user: string,
): Promise<LiveNotificationPreferences> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const row = await actor.get_preferences(user);
  return preferencesFromCandid(row);
}

export async function upsertLiveNotificationPreferences(
  ctx: FeatureBackendContext,
  user: string,
  input: LiveNotificationPreferencesInput,
): Promise<LiveNotificationPreferences> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const result = await unwrapCandid(
    actor.upsert_preferences(user, preferencesInputToCandid(input)),
    "Upsert notification preferences",
  );
  return preferencesFromCandid(result);
}

// ---------------------------------------------------------------------------
// Message digest reads (get_digest). record_digest_item is worker-guarded
// (the digest writer records items canister-side) and is intentionally NOT
// exposed here.
// ---------------------------------------------------------------------------

export type LiveDigestSource = "team" | "club" | "group";
export type LiveDigestClassification = "info" | "action" | "decision" | "question" | "social";

export interface LiveDigestItem {
  id: string;
  messageId: string;
  messageType: LiveDigestSource;
  chatScopeId: string;
  messageCreatedAtMs: number;
  classification: LiveDigestClassification;
  summary: string;
  topic: string | null;
  mentions: string[];
  provider: string | null;
  digestedAtMs: number;
}

function digestSourceToCandid(source: LiveDigestSource) {
  switch (source) {
    case "team":
      return { Team: null };
    case "club":
      return { Club: null };
    case "group":
      return { Group: null };
  }
}

function digestSourceFromCandid(source: unknown): LiveDigestSource {
  if (source && typeof source === "object") {
    if ("Team" in (source as object)) return "team";
    if ("Club" in (source as object)) return "club";
    if ("Group" in (source as object)) return "group";
  }
  throw new Error(`Unrecognized digest source: ${JSON.stringify(source)}`);
}

function digestClassificationFromCandid(value: unknown): LiveDigestClassification {
  if (value && typeof value === "object") {
    if ("Info" in (value as object)) return "info";
    if ("Action" in (value as object)) return "action";
    if ("Decision" in (value as object)) return "decision";
    if ("Question" in (value as object)) return "question";
    if ("Social" in (value as object)) return "social";
  }
  throw new Error(`Unrecognized digest classification: ${JSON.stringify(value)}`);
}

export async function getLiveDigest(
  ctx: FeatureBackendContext,
  source: LiveDigestSource,
  chatScopeId: string,
  sinceMs: number,
  limit = 200,
): Promise<LiveDigestItem[]> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const rows = await unwrapCandid(
    actor.get_digest(digestSourceToCandid(source), chatScopeId, BigInt(Math.trunc(sinceMs)), limit),
    "Get digest",
  );
  return rows.map((row) => ({
    id: row.id,
    messageId: row.message_id,
    messageType: digestSourceFromCandid(row.message_type),
    chatScopeId: row.chat_scope_id,
    messageCreatedAtMs: Number(row.message_created_at_ms),
    classification: digestClassificationFromCandid(row.classification),
    summary: row.summary,
    topic: row.topic[0] ?? null,
    mentions: row.mentions,
    provider: row.provider[0] ?? null,
    digestedAtMs: Number(row.digested_at_ms),
  }));
}

// ---------------------------------------------------------------------------
// Push alert settings (get_push_alert_settings / upsert_push_alert_settings).
//
// NOTE: this is a canister-wide SINGLETON, not per-user preferences — there
// is one set of alert thresholds for the whole deployment. Only surface this
// where an admin config UI already exists (e.g. PushAnalyticsPage's alert
// threshold editor). Push DELIVERY itself stays on Supabase; this only
// configures alerting thresholds for the (still-Supabase) delivery pipeline.
// ---------------------------------------------------------------------------

export interface LivePushAlertSettings {
  failureThresholdPercent: number;
  checkWindowHours: number;
  minNotifications: number;
  cooldownHours: number;
  alertsEnabled: boolean;
  updatedAtMs: number;
  updatedBy: string | null;
}

export type LivePushAlertSettingsInput = Omit<LivePushAlertSettings, "updatedAtMs" | "updatedBy">;

function pushAlertSettingsFromCandid(row: {
  failure_threshold_percent: number;
  check_window_hours: number;
  min_notifications: number;
  cooldown_hours: number;
  alerts_enabled: boolean;
  updated_at_ms: bigint;
  updated_by: [] | [string];
}): LivePushAlertSettings {
  return {
    failureThresholdPercent: row.failure_threshold_percent,
    checkWindowHours: row.check_window_hours,
    minNotifications: row.min_notifications,
    cooldownHours: row.cooldown_hours,
    alertsEnabled: row.alerts_enabled,
    updatedAtMs: Number(row.updated_at_ms),
    updatedBy: row.updated_by[0] ?? null,
  };
}

export async function getLivePushAlertSettings(
  ctx: FeatureBackendContext,
): Promise<LivePushAlertSettings> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const row = await actor.get_push_alert_settings();
  return pushAlertSettingsFromCandid(row);
}

export async function upsertLivePushAlertSettings(
  ctx: FeatureBackendContext,
  input: LivePushAlertSettingsInput,
): Promise<LivePushAlertSettings> {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  const row = await actor.upsert_push_alert_settings({
    failure_threshold_percent: input.failureThresholdPercent,
    check_window_hours: input.checkWindowHours,
    min_notifications: input.minNotifications,
    cooldown_hours: input.cooldownHours,
    alerts_enabled: input.alertsEnabled,
  });
  return pushAlertSettingsFromCandid(row);
}

// ---------------------------------------------------------------------------
// Chat notification fan-out batch and per-club preference listing.
// ---------------------------------------------------------------------------

export interface LiveChatNotifyBatchInput {
  messageId: string;
  conversationId: string;
  sender: string;
  preview: string;
  recipients: string[];
  muteList: string[];
}

/**
 * Idempotent per-message notify fan-out: one call per sent chat message,
 * skipping recipients in `muteList`. Returns the number of notifications
 * actually enqueued.
 */
export async function recordLiveChatNotifyBatch(
  ctx: FeatureBackendContext,
  input: LiveChatNotifyBatchInput,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.record_chat_notify_batch(
      input.messageId,
      input.conversationId,
      input.sender,
      input.preview,
      input.recipients,
      input.muteList,
    ),
    "Record chat notify batch",
  );
}

/**
 * Paged notification-preferences listing. NOTE: `clubId` is accepted for
 * API symmetry but is currently a no-op canister-side — `Preferences` has
 * no club column, so this returns the full preferences page regardless of
 * the club filter.
 */
export async function listLivePreferencesByClub(
  ctx: FeatureBackendContext,
  clubId: string,
  limit: number,
  offset: number,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_preferences_by_club(clubId, limit, offset),
    "List preferences by club",
  );
}
