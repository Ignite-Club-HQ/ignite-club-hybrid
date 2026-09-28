import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  chatTargetPath,
  type ChatTarget,
} from "./navigationPolicy";

type IgniteSupabaseClient = SupabaseClient<Database>;

export type LegacyReactionNotification = {
  related_id: string | null;
  user_id: string;
  created_at: string;
};

export type DirectNotificationTarget = {
  conversationId: string;
  messageId: string | null;
  path: string;
};

export type ScopedMessageNotificationTarget = {
  kind: "club" | "group" | "club_admin";
  targetId: string;
  messageId: string | null;
  path: string;
};

export async function resolveScopedMessageNotificationTarget(
  kind: "club" | "group" | "club_admin",
  relatedId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<ScopedMessageNotificationTarget | null> {
  if (kind === "club") {
    const { data } = await client.from("club_messages").select("club_id").eq("id", relatedId).maybeSingle();
    return data?.club_id
      ? { kind, targetId: data.club_id, messageId: relatedId, path: chatTargetPath(kind, data.club_id, relatedId) }
      : null;
  }
  if (kind === "group") {
    const { data } = await client.from("group_messages").select("group_id").eq("id", relatedId).maybeSingle();
    return data?.group_id
      ? { kind, targetId: data.group_id, messageId: relatedId, path: chatTargetPath(kind, data.group_id, relatedId) }
      : null;
  }

  const { data: message } = await client
    .from("club_admin_messages")
    .select("conversation_id")
    .eq("id", relatedId)
    .maybeSingle();
  if (message?.conversation_id) {
    return { kind, targetId: message.conversation_id, messageId: relatedId, path: chatTargetPath(kind, message.conversation_id, relatedId) };
  }
  const { data: conversation } = await client
    .from("club_admin_conversations")
    .select("id")
    .eq("id", relatedId)
    .maybeSingle();
  return conversation
    ? { kind, targetId: relatedId, messageId: null, path: `/messages/club-admin/${relatedId}` }
    : null;
}

export async function resolveDirectNotificationTarget(
  relatedId: string,
  currentUserId?: string,
  createdAt?: string | null,
  client: IgniteSupabaseClient = supabase,
): Promise<DirectNotificationTarget | null> {
  const { data: directMessage } = await client
    .from("direct_messages")
    .select("id, conversation_id")
    .eq("id", relatedId)
    .maybeSingle();
  if (directMessage?.conversation_id) {
    return {
      conversationId: directMessage.conversation_id,
      messageId: directMessage.id,
      path: `/messages/dm/${directMessage.conversation_id}?message=${directMessage.id}`,
    };
  }

  const { data: conversation } = await client
    .from("direct_conversations")
    .select("id")
    .eq("id", relatedId)
    .maybeSingle();
  if (!conversation) return null;

  const clickedAt = createdAt ? new Date(createdAt) : null;
  const upperBound = clickedAt && !Number.isNaN(clickedAt.getTime())
    ? new Date(clickedAt.getTime() + 30_000).toISOString()
    : null;
  let query = client
    .from("direct_messages")
    .select("id, conversation_id")
    .eq("conversation_id", relatedId)
    .is("deleted_at", null);
  if (currentUserId) query = query.neq("author_id", currentUserId);
  if (upperBound) query = query.lte("created_at", upperBound);
  const { data: nearestMessage } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return nearestMessage?.id
    ? { conversationId: relatedId, messageId: nearestMessage.id, path: `/messages/dm/${relatedId}?message=${nearestMessage.id}` }
    : { conversationId: relatedId, messageId: null, path: `/messages/dm/${relatedId}` };
}

type MessageReactionTargetRow = {
  team_message_id?: string | null;
  club_message_id?: string | null;
  group_message_id?: string | null;
  direct_message_id?: string | null;
  broadcast_message_id?: string | null;
  club_admin_message_id?: string | null;
};

export async function resolveLegacyReactionTarget(
  notification: LegacyReactionNotification,
  client: IgniteSupabaseClient = supabase,
): Promise<ChatTarget | null> {
  if (!notification.related_id) return null;
  const at = new Date(notification.created_at).getTime();
  if (!Number.isFinite(at)) return null;
  const from = new Date(at - 5000).toISOString();
  const to = new Date(at + 5000).toISOString();

  const { data: reactions } = await client
    .from("message_reactions")
    .select("team_message_id, club_message_id, group_message_id, direct_message_id, broadcast_message_id, club_admin_message_id, created_at")
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: false })
    .limit(30);

  const rows: MessageReactionTargetRow[] = Array.isArray(reactions) ? reactions : [];
  const pick = (key: keyof MessageReactionTargetRow) => rows
    .map((row) => row[key])
    .filter((id): id is string => Boolean(id));
  const relatedId = notification.related_id;
  const authorId = notification.user_id;

  const teamIds = pick("team_message_id");
  if (teamIds.length) {
    const { data } = await client.from("team_messages").select("id, team_id").in("id", teamIds).eq("team_id", relatedId).eq("author_id", authorId).limit(1);
    const message = data?.[0];
    if (message?.id && message.team_id) return { kind: "team", targetId: message.team_id, messageId: message.id, path: chatTargetPath("team", message.team_id, message.id) };
  }

  const clubIds = pick("club_message_id");
  if (clubIds.length) {
    const { data } = await client.from("club_messages").select("id, club_id").in("id", clubIds).eq("club_id", relatedId).eq("author_id", authorId).limit(1);
    const message = data?.[0];
    if (message?.id && message.club_id) return { kind: "club", targetId: message.club_id, messageId: message.id, path: chatTargetPath("club", message.club_id, message.id) };
  }

  const groupIds = pick("group_message_id");
  if (groupIds.length) {
    const { data } = await client.from("group_messages").select("id, group_id").in("id", groupIds).eq("group_id", relatedId).eq("author_id", authorId).limit(1);
    const message = data?.[0];
    if (message?.id && message.group_id) return { kind: "group", targetId: message.group_id, messageId: message.id, path: chatTargetPath("group", message.group_id, message.id) };
  }

  const directIds = pick("direct_message_id");
  if (directIds.length) {
    const { data } = await client.from("direct_messages").select("id, conversation_id").in("id", directIds).eq("conversation_id", relatedId).eq("author_id", authorId).limit(1);
    const message = data?.[0];
    if (message?.id && message.conversation_id) return { kind: "dm", targetId: message.conversation_id, messageId: message.id, path: chatTargetPath("dm", message.conversation_id, message.id) };
  }

  const broadcastIds = pick("broadcast_message_id");
  if (broadcastIds.length) {
    const { data } = await client.from("broadcast_messages").select("id").in("id", broadcastIds).eq("author_id", authorId).limit(1);
    const message = data?.[0];
    if (message?.id) return { kind: "broadcast", targetId: null, messageId: message.id, path: chatTargetPath("broadcast", null, message.id) };
  }

  const clubAdminIds = pick("club_admin_message_id");
  if (clubAdminIds.length) {
    const { data } = await client.from("club_admin_messages").select("id, conversation_id").in("id", clubAdminIds).eq("conversation_id", relatedId).eq("author_id", authorId).limit(1);
    const message = data?.[0];
    if (message?.id && message.conversation_id) return { kind: "club_admin", targetId: message.conversation_id, messageId: message.id, path: chatTargetPath("club_admin", message.conversation_id, message.id) };
  }

  return null;
}

export async function resolveLegacyReactionContainerPath(
  relatedId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string | null> {
  const { data: team } = await client.from("teams").select("id").eq("id", relatedId).maybeSingle();
  if (team) return `/messages/${relatedId}`;
  const { data: club } = await client.from("clubs").select("id").eq("id", relatedId).maybeSingle();
  if (club) return `/messages/club/${relatedId}`;
  const { data: group } = await client.from("chat_groups").select("id").eq("id", relatedId).maybeSingle();
  if (group) return `/groups/${relatedId}`;
  const { data: conversation } = await client.from("direct_conversations").select("id").eq("id", relatedId).maybeSingle();
  return conversation ? `/messages/dm/${relatedId}` : null;
}
