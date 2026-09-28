import { supabase } from "@/integrations/supabase/client";
import { MESSAGE_NOTIFICATION_TYPES } from "@/lib/notificationTypes";

export interface UnreadMessageCounts {
  broadcast: number;
  teams: Record<string, number>;
  clubs: Record<string, number>;
  groups: Record<string, number>;
  dms: Record<string, number>;
}

export const createEmptyUnreadMessageCounts = (): UnreadMessageCounts => ({
  broadcast: 0,
  teams: {},
  clubs: {},
  groups: {},
  dms: {},
});

export const getTotalUnreadMessageCount = (counts: UnreadMessageCounts): number => {
  const sumRecord = (record: Record<string, number>) =>
    Object.values(record).reduce((total, count) => total + count, 0);

  return (
    counts.broadcast +
    sumRecord(counts.teams) +
    sumRecord(counts.clubs) +
    sumRecord(counts.groups) +
    sumRecord(counts.dms)
  );
};

export async function fetchUnreadMessageCounts(userId: string): Promise<UnreadMessageCounts> {
  // Fast path: single RPC round-trip. Falls back to the legacy multi-query
  // path on any error so a regression cannot break the inbox.
  try {
    const { data, error } = await supabase.rpc("get_unread_message_counts", {
      _user_id: userId,
    });
    if (!error && data && typeof data === "object") {
      const d = data as any;
      return {
        broadcast: Number(d.broadcast) || 0,
        teams: (d.teams as Record<string, number>) || {},
        clubs: (d.clubs as Record<string, number>) || {},
        groups: (d.groups as Record<string, number>) || {},
        dms: (d.dms as Record<string, number>) || {},
      };
    }
  } catch {
    // fall through to legacy path
  }
  return fetchUnreadMessageCountsLegacy(userId);
}

async function fetchUnreadMessageCountsLegacy(userId: string): Promise<UnreadMessageCounts> {
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id, type, related_id")
    .eq("user_id", userId)
    .eq("is_read", false)
    .in("type", MESSAGE_NOTIFICATION_TYPES);

  if (error) throw error;

  const counts = createEmptyUnreadMessageCounts();

  if (!notifications?.length) return counts;

  const teamMessageIds: string[] = [];
  const clubMessageIds: string[] = [];
  const groupMessageIds: string[] = [];
  const dmCountsByConversation: Record<string, number> = {};

  notifications.forEach((notification) => {
    if (notification.type === "broadcast") {
      counts.broadcast += 1;
      return;
    }

    if (!notification.related_id) return;

    if (notification.type === "team_message") {
      teamMessageIds.push(notification.related_id);
      return;
    }

    if (notification.type === "club_message") {
      clubMessageIds.push(notification.related_id);
      return;
    }

    if (notification.type === "group_message") {
      groupMessageIds.push(notification.related_id);
      return;
    }

    if (notification.type === "direct_message") {
      dmCountsByConversation[notification.related_id] = (dmCountsByConversation[notification.related_id] || 0) + 1;
    }
  });

  if (teamMessageIds.length > 0) {
    const { data: teamMessages, error: teamError } = await supabase
      .from("team_messages")
      .select("id, team_id")
      .in("id", teamMessageIds);

    if (teamError) throw teamError;

    teamMessages?.forEach((message) => {
      if (message.team_id) {
        counts.teams[message.team_id] = (counts.teams[message.team_id] || 0) + 1;
      }
    });
  }

  if (clubMessageIds.length > 0) {
    const { data: clubMessages, error: clubError } = await supabase
      .from("club_messages")
      .select("id, club_id")
      .in("id", clubMessageIds);

    if (clubError) throw clubError;

    clubMessages?.forEach((message) => {
      if (message.club_id) {
        counts.clubs[message.club_id] = (counts.clubs[message.club_id] || 0) + 1;
      }
    });
  }

  if (groupMessageIds.length > 0) {
    const { data: groupMessages, error: groupError } = await supabase
      .from("group_messages")
      .select("id, group_id")
      .in("id", groupMessageIds);

    if (groupError) throw groupError;

    groupMessages?.forEach((message) => {
      if (message.group_id) {
        counts.groups[message.group_id] = (counts.groups[message.group_id] || 0) + 1;
      }
    });
  }

  const dmConversationIds = Object.keys(dmCountsByConversation);

  if (dmConversationIds.length > 0) {
    const { data: directMessages, error: dmError } = await supabase
      .from("direct_messages")
      .select("conversation_id, author_id, created_at")
      .in("conversation_id", dmConversationIds)
      .order("created_at", { ascending: false });

    if (dmError) throw dmError;

    const latestAuthorByConversation: Record<string, string> = {};

    directMessages?.forEach((message) => {
      if (!latestAuthorByConversation[message.conversation_id]) {
        latestAuthorByConversation[message.conversation_id] = message.author_id;
      }
    });

    dmConversationIds.forEach((conversationId) => {
      if (latestAuthorByConversation[conversationId] !== userId) {
        counts.dms[conversationId] = dmCountsByConversation[conversationId];
      }
    });
  }

  return counts;
}
