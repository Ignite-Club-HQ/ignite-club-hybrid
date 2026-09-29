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

export async function sendLiveMessage(
  ctx: FeatureBackendContext,
  conversationId: string,
  body: string,
  idempotencyKey: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.send_message(conversationId, body, idempotencyKey),
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
