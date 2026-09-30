import type { Principal } from "@icp-sdk/core/principal";
import { connectLiveMessagingDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, unwrapCandid } from "./candid";

/**
 * Messaging feature -> messaging_domain canister.
 *
 * Canister-side counterpart of the Supabase chat data layer in
 * `features/messaging/`. Routed to only when placement settings resolve ICP
 * and a messaging_domain canister ID is configured.
 *
 * NOTE: untested against a live canister until deployment. The canister has
 * no realtime broadcast — live message updates need polling or a future
 * push path; the Supabase branch keeps its realtime channels.
 */

export async function createLiveConversation(
  ctx: FeatureBackendContext,
  clubId: string,
  participants: Principal[],
  teamId?: string | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_conversation(clubId, candidOpt(teamId), participants),
    "Create conversation",
  );
}

export async function listLiveMessages(
  ctx: FeatureBackendContext,
  conversationId: string,
  afterMs?: number | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.list_messages(
    conversationId,
    candidOpt(afterMs === null || afterMs === undefined ? undefined : BigInt(afterMs)),
  );
}

export async function listLiveMessagesPage(
  ctx: FeatureBackendContext,
  conversationId: string,
  afterMs: number | null,
  limit: number,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_messages_page(
      conversationId,
      candidOpt(afterMs === null ? undefined : BigInt(afterMs)),
      limit,
    ),
    "List messages",
  );
}

export interface LiveMessageAttachment {
  /** "poll" | "news" | "image" — matches the group chat composer payloads. */
  kind: string;
  refId: string;
  url?: string | null;
}

export async function sendLiveMessage(
  ctx: FeatureBackendContext,
  conversationId: string,
  body: string,
  idempotencyKey: string,
  attachment?: LiveMessageAttachment | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.send_message(
      conversationId,
      body,
      idempotencyKey,
      candidOpt(
        attachment
          ? { kind: attachment.kind, ref_id: attachment.refId, url: candidOpt(attachment.url) }
          : null,
      ),
    ),
    "Send message",
  );
}

export async function updateLiveMessage(
  ctx: FeatureBackendContext,
  messageId: string,
  body: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.update_message(messageId, body), "Update message");
}

export async function deleteLiveMessage(ctx: FeatureBackendContext, messageId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_message(messageId), "Delete message");
}

export async function markLiveConversationRead(
  ctx: FeatureBackendContext,
  conversationId: string,
  messageId: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.mark_read(conversationId, messageId), "Mark read");
}

export async function getLiveUnreadCount(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unread_count(conversationId), "Unread count");
}

export interface LiveAnnouncementInput {
  clubId: string;
  teamIds: string[];
  includeClubChat: boolean;
  body: string;
  idempotencyKey: string;
}

/**
 * Club announcement fan-out (the canister counterpart of the
 * send-club-announcement edge function): posts the message to the club chat
 * and/or each listed team's conversation in one call. Teams without a
 * canister conversation are skipped and reported in `skipped`, never
 * fatal. The caller must be a club admin on the canister; announcements
 * allow a longer body than the 128-char chat message limit.
 */
export async function broadcastLiveAnnouncement(
  ctx: FeatureBackendContext,
  input: LiveAnnouncementInput,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.broadcast_announcement(
      input.clubId,
      input.teamIds,
      input.includeClubChat,
      input.body,
      input.idempotencyKey,
    ),
    "Broadcast announcement",
  );
}

export interface LiveGroupMetadata {
  conversationId: string;
  kind: string;
  name: string;
  teamId: string | null;
  clubId: string | null;
  members: Principal[];
  createdAtMs: number;
}

function toLiveGroupMetadata(raw: {
  conversation_id: string;
  kind: string;
  name: string;
  team_id: [] | [string];
  club_id: [] | [string];
  members: Principal[];
  created_at_ms: bigint;
}): LiveGroupMetadata {
  return {
    conversationId: raw.conversation_id,
    kind: raw.kind,
    name: raw.name,
    teamId: raw.team_id[0] ?? null,
    clubId: raw.club_id[0] ?? null,
    members: raw.members,
    createdAtMs: Number(raw.created_at_ms),
  };
}

/**
 * Group/team/competition-thread metadata (name, kind, members) — the
 * canister counterpart of the Supabase `chat_groups` row read.
 */
export async function upsertLiveGroupMetadata(
  ctx: FeatureBackendContext,
  conversationId: string,
  kind: string,
  name: string,
  teamId: string | null | undefined,
  clubId: string | null | undefined,
  members: Principal[],
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(
    actor.upsert_group_metadata(
      conversationId,
      kind,
      name,
      candidOpt(teamId),
      candidOpt(clubId),
      members,
    ),
    "Upsert group metadata",
  );
  return toLiveGroupMetadata(raw);
}

export async function getLiveGroupMetadata(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.get_group_metadata(conversationId), "Get group metadata");
  return toLiveGroupMetadata(raw);
}

/**
 * Club membership roster used by `can_dm_user` / messaging ACL checks on the
 * canister. NOTE: there is no frontend membership-write path that produces
 * an Internet-Identity-keyed club membership row yet (team/club membership
 * is still written to Supabase `user_roles` keyed by uuid) — this wrapper is
 * intentionally unused today. It exists so the future Supabase->ICP
 * membership migration can call it directly once club membership writes
 * move to identity_access/club_domain principals.
 */
export async function upsertLiveClubMembership(
  ctx: FeatureBackendContext,
  user: Principal,
  clubId: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.upsert_club_membership(user, clubId), "Upsert club membership");
}

/** Whether the caller is allowed to open/continue a DM with `other`. */
export async function canLiveDmUser(ctx: FeatureBackendContext, other: Principal) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.can_dm_user(other);
}

/** App-admin-controlled per-user disable of the DM "+" attachment menu. */
export async function setLiveDmAttachmentsDisabled(
  ctx: FeatureBackendContext,
  user: Principal,
  disabled: boolean,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_dm_attachments_disabled(user, disabled),
    "Set DM attachments disabled",
  );
}

export async function isLiveDmAttachmentsDisabled(ctx: FeatureBackendContext, user: Principal) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.dm_attachments_disabled(user);
}

/** Grants competition-admin standing for a conversation (enforced canister-side in send_message). */
export async function grantLiveCompetitionAdmin(
  ctx: FeatureBackendContext,
  conversationId: string,
  user: Principal,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.grant_competition_admin(conversationId, user),
    "Grant competition admin",
  );
}

export async function isLiveCompetitionAdmin(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.is_competition_admin(conversationId);
}

export interface LiveUnreadSummary {
  conversationId: string;
  kind: string;
  count: number;
}

/** Per-conversation unread counts for the caller — the canister counterpart of `get_unread_message_counts`. */
export async function myLiveUnreadCounts(ctx: FeatureBackendContext): Promise<LiveUnreadSummary[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await actor.my_unread_counts();
  return raw.map((r) => ({ conversationId: r.conversation_id, kind: r.kind, count: Number(r.count) }));
}
